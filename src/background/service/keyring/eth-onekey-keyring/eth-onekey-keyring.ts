import EventEmitter from 'events';
import {
  toChecksumAddress,
  stripHexPrefix,
  addHexPrefix,
  publicToAddress,
  bufferToHex,
} from '@ethereumjs/util';
import * as sigUtil from 'eth-sig-util';
import type { Response } from '@onekeyfe/hd-core';
import { HardwareErrorCode } from '@onekeyfe/hd-shared';
import { t } from 'i18next';
import {
  FeeMarketEIP1559Transaction,
  Transaction,
  TransactionFactory,
  TypedTransaction,
} from '@ethereumjs/tx';
import HDKey from 'hdkey';
import { isSameAddress } from '@/background/utils';
import { OneKeyBridgeInterface } from './onekey-bridge-interface';
import { isManifestV3 } from '@/utils/env';
import browser from 'webextension-polyfill';

const keyringType = 'Onekey Hardware';
const hdPathString = "m/44'/60'/0'/0";
const pathBase = 'm';
const MAX_INDEX = 1000;
const DELAY_BETWEEN_POPUPS = 1000;
const ONEKEY_SESSION_STATE_KEY = 'onekeySessionState';
// HardwareErrorCode.DeviceNotOpenedPassphrase from @onekeyfe/hd-shared
const DEVICE_NOT_OPENED_PASSPHRASE = 113;

function handleDeviceError(
  errorCode: string | number | undefined,
  errorMessage: string
) {
  let msg = errorMessage;
  switch (errorCode?.toString()) {
    case HardwareErrorCode.DeviceNotFound.toString():
      msg = t('background.keyring.onekey.notFoundDevice');
      break;
    case HardwareErrorCode.WebDeviceNotFoundOrNeedsPermission.toString():
      msg = t('background.keyring.onekey.deviceNeedsWebHIDPermission');
      break;
    case HardwareErrorCode.DeviceInterruptedFromOutside.toString():
    case HardwareErrorCode.DeviceInterruptedFromUser.toString():
      msg = t('background.keyring.onekey.deviceInterrupted');
      break;
    case HardwareErrorCode.PinInvalid.toString():
      msg = t('background.keyring.onekey.pinInvalid');
      break;
    case HardwareErrorCode.DeviceBusy.toString():
      msg = t('background.keyring.onekey.deviceBusy');
      break;
    case HardwareErrorCode.CallQueueActionCancelled.toString():
    case HardwareErrorCode.ActionCancelled.toString():
    case HardwareErrorCode.PinCancelled.toString():
      msg = t('background.keyring.onekey.actionCancel');
      break;
    case HardwareErrorCode.DeviceInitializeFailed.toString():
      msg = t('background.keyring.onekey.deviceInitializeFailed');
      break;
    case HardwareErrorCode.NewFirmwareForceUpdate.toString():
      msg = t('background.keyring.onekey.needUpgradeFirmware');
      break;
    case HardwareErrorCode.CallMethodNeedUpgradeFirmware.toString():
      msg = t('background.keyring.onekey.thisMethodNeedUpgradeFirmware');
      break;
    case HardwareErrorCode.DeviceDetectInBootloaderMode.toString():
    case HardwareErrorCode.NotAllowInBootloaderMode.toString():
      msg = t('background.keyring.onekey.notAllowInBootloaderMode');
      break;
    case HardwareErrorCode.DeviceCheckPassphraseStateError.toString():
    case HardwareErrorCode.DeviceCheckUnlockTypeError.toString():
      msg = t('background.keyring.onekey.deviceCheckPassphraseStateError');
      break;
    default:
      msg = errorMessage;
  }

  return Object.assign(new Error(`${errorCode}: ${msg}`), {
    code:
      errorCode !== undefined && Number.isFinite(Number(errorCode))
        ? Number(errorCode)
        : errorCode,
  });
}

function toError(e: unknown): Error {
  if (e instanceof Error) {
    const code = (e as any).code ?? (e as any).errorCode;
    if (code !== undefined) Object.assign(e, { code });
    return e;
  }
  if (typeof e === 'string') {
    return new Error(e);
  }
  const payload = e as {
    message?: unknown;
    error?: unknown;
    code?: unknown;
    errorCode?: unknown;
  } | null;
  const message = payload?.message ?? payload?.error;
  const code = payload?.code ?? payload?.errorCode;
  if (code !== undefined) {
    return handleDeviceError(
      code as string | number,
      String(message ?? 'Unknown error')
    );
  }
  if (typeof message === 'string' && message) {
    return Object.assign(new Error(message), {
      code: payload?.code ?? payload?.errorCode,
    });
  }
  try {
    return new Error(JSON.stringify(e) ?? 'Unknown error');
  } catch {
    return new Error('Unknown error');
  }
}

function isPassphraseDisabledError(payload?: {
  code?: unknown;
  error?: unknown;
}) {
  return (
    payload?.code === DEVICE_NOT_OPENED_PASSPHRASE ||
    /passphrase disabled/i.test(String(payload?.error ?? ''))
  );
}

function isUnsupportedWalletSessionError(payload: any) {
  const code = String(payload?.code ?? payload?.errorCode);
  return (
    code === '-32601' ||
    /^method[ _-]?not[ _-]?(allowed|found)$/i.test(code) ||
    /(?:action|method).*(?:not supported|unsupported|not found|not allowed)|(?:unsupported|unknown) (?:action|method)/i.test(
      String(payload?.error ?? payload?.message ?? payload ?? '')
    )
  );
}

interface OneKeySessionState {
  passphraseState: string | undefined;
  deviceId: string;
  connectId: string;
  publicKey: string;
  chainCode: string;
}

export enum LedgerHDPathType {
  LedgerLive = 'LedgerLive',
  Legacy = 'Legacy',
  BIP44 = 'BIP44',
}

type HDPathType = LedgerHDPathType;

interface Account {
  address: string;
  index: number;
}

interface AccountDetail {
  hdPathBasePublicKey?: string;
  hdPath: string;
  hdPathType: HDPathType;
  index: number;
  passphraseState?: string;
}

class OneKeyKeyring extends EventEmitter {
  static type = keyringType;
  type = keyringType;
  accounts: string[] = [];
  hdk = new HDKey();
  page = 0;
  perPage = 5;
  unlockedAccount = 0;
  paths = {};
  hdPath = '';
  deviceId: string | null = null;
  connectId: string | null = null;
  passphraseState: string | undefined = undefined;
  accountDetails: Record<string, AccountDetail>;

  bridge!: OneKeyBridgeInterface;

  constructor(
    opts: any & {
      bridge: OneKeyBridgeInterface;
    } = {}
  ) {
    super();
    if (!opts.bridge) {
      throw new Error('Bridge is required');
    }
    this.bridge = opts.bridge;
    this.accountDetails = {};
    this.deserialize(opts);
  }

  private sessionStatePromise?: Promise<void>;
  private restoreSessionState = true;

  async init() {
    await this.bridge.init();
    if (!this.sessionStatePromise) {
      this.sessionStatePromise = this.restoreStoredSession().catch((error) => {
        this.sessionStatePromise = undefined;
        throw error;
      });
    }
    return this.sessionStatePromise;
  }

  private async restoreStoredSession() {
    if (isManifestV3) {
      // resume passphrase state from session after sw inactive
      const value = await browser.storage.session.get(ONEKEY_SESSION_STATE_KEY);
      const state: OneKeySessionState = value[ONEKEY_SESSION_STATE_KEY];
      if (state && this.restoreSessionState) {
        this.passphraseState = state.passphraseState;
        this.deviceId = state.deviceId;
        this.connectId = state.connectId;
        this.hdk.publicKey = Buffer.from(state.publicKey, 'hex');
        this.hdk.chainCode = Buffer.from(state.chainCode, 'hex');
      }
    }
  }

  serialize(): Promise<any> {
    return Promise.resolve({
      hdPath: this.hdPath,
      accounts: this.accounts,
      page: this.page,
      paths: this.paths,
      perPage: this.perPage,
      unlockedAccount: this.unlockedAccount,
      accountDetails: this.accountDetails,
    });
  }

  deserialize(opts: any = {}): Promise<void> {
    this.hdPath = opts.hdPath || hdPathString;
    this.accounts = opts.accounts || [];
    this.page = opts.page || 0;
    this.perPage = 5;
    this.paths = opts.paths || {};
    this.accountDetails = opts.accountDetails || {};
    return Promise.resolve();
  }

  isUnlocked(): boolean {
    return Boolean(this.hdk && this.hdk.publicKey);
  }

  private cancellationVersion = 0;
  private pendingSignings = 0;
  private unlockPromise?: Promise<string>;

  cancel() {
    this.cancellationVersion += 1;
    return this.bridge.cancel(this.connectId || undefined);
  }

  cleanUp(cancelPending = false) {
    this.restoreSessionState = false;
    this.hdk = new HDKey();
    if (cancelPending) {
      if (this.unlockPromise || this.pendingSignings) return this.cancel();
      this.cancellationVersion += 1;
    }
  }

  private async persistSessionPassphraseState() {
    if (!isManifestV3) {
      return;
    }
    const value = await browser.storage.session.get(ONEKEY_SESSION_STATE_KEY);
    const state: OneKeySessionState | undefined =
      value[ONEKEY_SESSION_STATE_KEY];
    if (!state) {
      return;
    }
    await browser.storage.session.set({
      [ONEKEY_SESSION_STATE_KEY]: {
        ...state,
        passphraseState: this.passphraseState,
      },
    });
  }

  /**
   * The device can reject a signature with DeviceNotOpenedPassphrase (113)
   * when passphrase protection was turned off after this wallet was imported,
   * leaving a stale passphraseState. If the standard wallet provably owns the
   * account, drop the stale state and retry the same call once.
   */
  private async _withPassphraseRecovery<T>(
    address: string,
    params: Record<string, any>,
    call: (params: Record<string, any>) => Response<T>
  ): Response<T> {
    const cancellationVersion = this.cancellationVersion;
    const response = await call(params);
    if (
      response.success ||
      !isPassphraseDisabledError(response.payload) ||
      this._isEmptyPassphrase(params.passphraseState) ||
      cancellationVersion !== this.cancellationVersion
    ) {
      return response;
    }

    // Signing passes the same (possibly unset) ids: a single plugged-in
    // device signs fine without them, so the address check must too.
    const connectId = this.connectId!;
    const deviceId = this.deviceId!;
    const path = params.path;
    if (path === undefined) {
      return response;
    }

    let derivedAddress: string;
    try {
      const publicKey = await this.bridge.evmGetPublicKey(connectId, deviceId, {
        path,
        showOnOneKey: false,
        chainId: 1,
        useEmptyPassphrase: true,
      });
      if (
        !publicKey.success ||
        cancellationVersion !== this.cancellationVersion
      ) {
        return response;
      }
      derivedAddress = toChecksumAddress(
        bufferToHex(
          publicToAddress(Buffer.from(publicKey.payload.pub, 'hex'), true)
        )
      );
    } catch {
      return response;
    }
    if (!isSameAddress(derivedAddress, address)) {
      // A genuinely hidden wallet: surface the original error unchanged.
      return response;
    }

    const checksummedAddress = toChecksumAddress(address);
    const detail = this.accountDetails[checksummedAddress];
    if (detail) {
      detail.passphraseState = undefined;
    }
    if (this.passphraseState === params.passphraseState) {
      this.passphraseState = undefined;
      await this.persistSessionPassphraseState();
    }

    if (cancellationVersion !== this.cancellationVersion) {
      return response;
    }

    return call({
      ...params,
      passphraseState: undefined,
      useEmptyPassphrase: true,
    });
  }

  unlock(): Promise<string> {
    if (!this.unlockPromise) {
      this.unlockPromise = this.unlockDevice().finally(() => {
        this.unlockPromise = undefined;
      });
    }
    return this.unlockPromise;
  }

  private unlockDevice(): Promise<string> {
    const cancellationVersion = this.cancellationVersion;
    const checkCancelled = () => {
      if (cancellationVersion !== this.cancellationVersion) {
        throw new Error('OneKey signing cancelled');
      }
    };
    // if (this.isUnlocked()) {
    //   return Promise.resolve('already unlocked');
    // }
    return new Promise((resolve, rejectRaw) => {
      // Reject with real Errors: the UI<->background channel only forwards
      // error.message, so string rejections reached the UI as `{}`.
      const reject = (e: any) => {
        rejectRaw(toError(e));
      };
      this.init()
        .then(() => {
          checkCancelled();
          return this.bridge.searchDevices();
        })
        .then(async (result) => {
          checkCancelled();
          if (!result.success) {
            reject(result.payload);
            return;
          } else {
            if (result.payload.length <= 0) {
              reject(
                handleDeviceError(
                  HardwareErrorCode.DeviceNotFound,
                  'No OneKey Device found'
                )
              );
              return;
            }
            const device = result.payload[0];
            const { connectId } = device;
            if (!connectId) {
              reject('no connectId');
              return;
            }
            const previousConnectId = this.connectId;
            this.connectId = connectId;
            const state = await this.bridge.getDeviceState(connectId);
            checkCancelled();
            if (!state.success) {
              reject(state.payload);
              return;
            }
            const deviceId = state.payload.identity.deviceId;
            if (!deviceId || !connectId) {
              reject('no deviceId or connectId');
              return;
            }
            if (
              this.deviceId &&
              this.connectId &&
              this.isUnlocked() &&
              this.deviceId === deviceId &&
              previousConnectId === connectId
            ) {
              resolve('already unlocked');
              return;
            }
            this.deviceId = deviceId;
            this.connectId = connectId;
            const passphraseProtectionOff =
              state.payload.status?.passphraseProtection === false;
            let importedPassphraseState: string | undefined;
            const openWalletSession = this.bridge.openWalletSession;
            let walletSession:
              | Awaited<ReturnType<NonNullable<typeof openWalletSession>>>
              | undefined;
            if (state.payload.protocol === 'V2' && openWalletSession) {
              // Protocol V2 (Pro 2): openWalletSession selects the standard or
              // a hidden wallet explicitly. The SDK rejects useEmptyPassphrase
              // / passphraseState passed to this call.
              const mode = passphraseProtectionOff
                ? 'standard'
                : 'select-hidden';
              try {
                walletSession = await openWalletSession.call(
                  this.bridge,
                  connectId,
                  { mode }
                );
                checkCancelled();
                if (
                  !walletSession.success &&
                  mode === 'select-hidden' &&
                  isPassphraseDisabledError(walletSession.payload)
                ) {
                  walletSession = await openWalletSession.call(
                    this.bridge,
                    connectId,
                    { mode: 'standard' }
                  );
                  checkCancelled();
                }
              } catch (error) {
                if (!isUnsupportedWalletSessionError(error)) {
                  throw error;
                }
                walletSession = undefined;
              }
              if (
                walletSession &&
                !walletSession.success &&
                isUnsupportedWalletSessionError(walletSession.payload)
              ) {
                walletSession = undefined;
              }
            }
            checkCancelled();
            if (walletSession) {
              if (!walletSession.success) {
                reject(walletSession.payload);
                return;
              }
              importedPassphraseState = await this._resolvePassphraseStateForImport(
                {
                  connectId,
                  protocol: state.payload.protocol,
                  walletType: walletSession.payload.walletType,
                  passphraseState: walletSession.payload.passphraseState,
                }
              );
            } else {
              // Legacy / Protocol V1 path.
              let standardWallet = passphraseProtectionOff;
              let passphraseState = await this.bridge.getPassphraseState(
                connectId,
                standardWallet ? { useEmptyPassphrase: true } : undefined
              );
              checkCancelled();
              if (
                !passphraseState.success &&
                !standardWallet &&
                isPassphraseDisabledError(passphraseState.payload)
              ) {
                standardWallet = true;
                passphraseState = await this.bridge.getPassphraseState(
                  connectId,
                  { useEmptyPassphrase: true }
                );
                checkCancelled();
              }
              if (!passphraseState.success) {
                reject(passphraseState.payload);
                return;
              }
              // On V2 the standard-wallet session still returns a wallet id
              // (btc_test_address). Passing it on a passphrase-off device makes
              // the SDK throw DeviceNotOpenedPassphrase (113), so the standard
              // wallet is represented by an empty passphraseState.
              importedPassphraseState = await this._resolvePassphraseStateForImport(
                {
                  connectId,
                  protocol: state.payload.protocol,
                  passphraseState: standardWallet
                    ? undefined
                    : passphraseState.payload || undefined,
                }
              );
            }
            checkCancelled();
            this.passphraseState = importedPassphraseState;
            return this.bridge
              .evmGetPublicKey(connectId, deviceId, {
                showOnOneKey: false,
                chainId: 1,
                path: hdPathString,
                passphraseState: this.passphraseState,
                useEmptyPassphrase: this._isEmptyPassphrase(
                  this.passphraseState
                ),
              })
              .then(async (res) => {
                checkCancelled();
                if (res.success) {
                  this.hdk.publicKey = Buffer.from(res.payload.pub, 'hex');
                  this.hdk.chainCode = Buffer.from(
                    res.payload.node.chain_code,
                    'hex'
                  );
                  if (isManifestV3) {
                    const sessionState: OneKeySessionState = {
                      passphraseState: this.passphraseState,
                      publicKey: res.payload.pub,
                      chainCode: res.payload.node.chain_code,
                      deviceId,
                      connectId,
                    };
                    await browser.storage.session.set({
                      [ONEKEY_SESSION_STATE_KEY]: sessionState,
                    });
                  }
                  checkCancelled();
                  resolve('just unlocked');
                } else {
                  reject(res.payload);
                  return;
                }
              });
          }
        })
        .catch((e) => {
          reject(toError(e));
          return;
        });
    });
  }

  setAccountToUnlock(index: string): void {
    this.unlockedAccount = parseInt(index, 10);
  }

  addAccounts(n = 1): Promise<any> {
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          const from = this.unlockedAccount;
          const to = from + n;

          for (let i = from; i < to; i++) {
            const address = this._addressFromIndex(pathBase, i);
            if (!this.accounts.includes(address)) {
              this.accounts.push(address);
              this.accountDetails[toChecksumAddress(address)] = {
                hdPath: this._pathFromAddress(address),
                hdPathType: LedgerHDPathType.BIP44,
                hdPathBasePublicKey: this.getPathBasePublicKey(),
                index: i,
              };
            }
            this.page = 0;
          }
          resolve(this.accounts);
        })
        .catch((e) => {
          reject(e);
          return;
        });
    });
  }

  getFirstPage(): Promise<any> {
    this.page = 0;
    return this.__getPage(1);
  }

  getNextPage(): Promise<any> {
    return this.__getPage(1);
  }

  getPreviousPage(): Promise<any> {
    return this.__getPage(-1);
  }
  getAddresses(start: number, end: number): Promise<any> {
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          const from = start;
          const to = end;

          const accounts: any[] = [];

          for (let i = from; i < to; i++) {
            const address = this._addressFromIndex(pathBase, i);
            accounts.push({
              address,
              balance: null,
              index: i + 1,
            });
            this.paths[toChecksumAddress(address)] = i;
          }
          resolve(accounts);
        })
        .catch((e) => {
          reject(e);
          return;
        });
    });
  }
  __getPage(increment: number): Promise<any> {
    this.page += increment;

    if (this.page <= 0) {
      this.page = 1;
    }

    return new Promise((resolve, reject) => {
      this.unlock()
        .then((_) => {
          const from = (this.page - 1) * this.perPage;
          const to = from + this.perPage;

          const accounts: any[] = [];

          for (let i = from; i < to; i++) {
            const address = this._addressFromIndex(pathBase, i);
            accounts.push({
              address,
              balance: null,
              index: i + 1,
            });
            this.paths[toChecksumAddress(address)] = i;
          }
          resolve(accounts);
        })
        .catch((e) => {
          reject(e);
          return;
        });
    });
  }

  getAccounts(): Promise<string[]> {
    return Promise.resolve(this.accounts.slice());
  }

  removeAccount(address: string): void {
    if (
      !this.accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())
    ) {
      throw new Error(`Address ${address} not found in this keyring`);
    }
    this.accounts = this.accounts.filter(
      (a) => a.toLowerCase() !== address.toLowerCase()
    );
    const checksummedAddress = toChecksumAddress(address);
    delete this.accountDetails[checksummedAddress];
    delete this.paths[checksummedAddress];
  }

  // tx is an instance of the ethereumjs-transaction class.
  signTransaction(address: string, tx: TypedTransaction): Promise<any> {
    this.pendingSignings += 1;
    const cancellationVersion = this.cancellationVersion;
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((status) => {
          setTimeout(
            (_) => {
              if (cancellationVersion !== this.cancellationVersion) {
                reject(new Error('OneKey signing cancelled'));
                return;
              }
              this._signTransaction(
                address,
                Number(tx.common.chainId()),
                tx,
                (payload) => {
                  // Because tx will be immutable, first get a plain javascript object that
                  // represents the transaction. Using txData here as it aligns with the
                  // nomenclature of ethereumjs/tx.
                  const txData = tx.toJSON();
                  // The fromTxData utility expects a type to support transactions with a type other than 0
                  txData.type = `0x${tx.type.toString(16)}`;
                  // The fromTxData utility expects v,r and s to be hex prefixed
                  txData.v = addHexPrefix(payload.v);
                  txData.r = addHexPrefix(payload.r);
                  txData.s = addHexPrefix(payload.s);
                  // Adopt the 'common' option from the original transaction and set the
                  // returned object to be frozen if the original is frozen.
                  return TransactionFactory.fromTxData(txData, {
                    common: tx.common,
                    freeze: Object.isFrozen(tx),
                  });
                }
              )
                .then(resolve)
                .catch(reject);

              // This is necessary to avoid popup collision
              // between the unlock & sign trezor popups
            },
            status === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0
          );
        })
        .catch((e) => {
          reject(toError(e));
          return;
        });
    }).finally(() => {
      this.pendingSignings -= 1;
    });
  }

  async _signTransaction(
    address,
    chainId,
    tx: TypedTransaction,
    handleSigning
  ) {
    const cancellationVersion = this.cancellationVersion;
    // new-style transaction from @ethereumjs/tx package
    // we can just copy tx.toJSON() for everything except chainId, which must be a number
    const transaction = {
      ...tx.toJSON(),
      chainId,
      to: tx.to?.toString(),
    };
    const params = {
      path: this._pathFromAddress(address),
      passphraseState: this.passphraseState,
      useEmptyPassphrase: this._isEmptyPassphrase(this.passphraseState),
      transaction: transaction as any,
    };
    return this._withPassphraseRecovery(address, params, (p) =>
      this.bridge.evmSignTransaction(this.connectId!, this.deviceId!, p as any)
    ).then((res) => {
      if (cancellationVersion !== this.cancellationVersion) {
        throw new Error('OneKey signing cancelled');
      }
      if (res.success) {
        const newOrMutatedTx: TypedTransaction = handleSigning(res.payload);
        const addressSignedWith = toChecksumAddress(
          addHexPrefix(newOrMutatedTx.getSenderAddress().toString())
        );
        const correctAddress = toChecksumAddress(address);
        if (addressSignedWith !== correctAddress) {
          throw new Error('signature doesnt match the right address');
        }

        return newOrMutatedTx;
      } else {
        throw toError(res.payload);
      }
    });
  }

  signMessage(withAccount: string, data: string): Promise<any> {
    return this.signPersonalMessage(withAccount, data);
  }

  // For personal_sign, we need to prefix the message:
  signPersonalMessage(withAccount: string, message: string): Promise<any> {
    this.pendingSignings += 1;
    const cancellationVersion = this.cancellationVersion;
    return new Promise((resolve, reject) => {
      this.unlock()
        .then((status) => {
          setTimeout(
            (_) => {
              if (cancellationVersion !== this.cancellationVersion) {
                reject(new Error('OneKey signing cancelled'));
                return;
              }
              const params = {
                path: this._pathFromAddress(withAccount),
                messageHex: stripHexPrefix(message),
                passphraseState: this.passphraseState,
                useEmptyPassphrase: this._isEmptyPassphrase(
                  this.passphraseState
                ),
              };
              this._withPassphraseRecovery(withAccount, params, (p) =>
                this.bridge.evmSignMessage(
                  this.connectId!,
                  this.deviceId!,
                  p as any
                )
              )
                .then((response) => {
                  if (cancellationVersion !== this.cancellationVersion) {
                    reject(new Error('OneKey signing cancelled'));
                    return;
                  }
                  if (response.success) {
                    const signature = `0x${response.payload.signature}`;
                    let recovered: string;
                    try {
                      recovered = sigUtil.recoverPersonalSignature({
                        // Recover over the exact bytes sent to the device.
                        data: addHexPrefix(stripHexPrefix(message)),
                        sig: signature,
                      });
                    } catch (e) {
                      this.cleanUp();
                      reject(toError(e));
                      return;
                    }
                    if (!isSameAddress(recovered, withAccount)) {
                      this.cleanUp();
                      reject(
                        new Error('signature doesnt match the right address')
                      );
                      return;
                    }
                    resolve(signature);
                  } else {
                    reject(toError(response.payload));
                    return;
                  }
                })
                .catch((e) => {
                  console.log('Error while trying to sign a message ', e);
                  reject(toError(e));
                  return;
                });
              // This is necessary to avoid popup collision
              // between the unlock & sign trezor popups
            },
            status === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0
          );
        })
        .catch((e) => {
          console.log('Error while trying to sign a message ', e);
          reject(toError(e));
          return;
        });
    }).finally(() => {
      this.pendingSignings -= 1;
    });
  }

  async signTypedData(address, data, opts) {
    switch (opts.version) {
      case 'V1':
        return this.signTypedData_v1(address, data, opts);
      case 'V3':
        return this.signTypedData_v3_v4(address, data, opts);
      case 'V4':
        return this.signTypedData_v3_v4(address, data, opts);
      default:
        return this.signTypedData_v1(address, data, opts);
    }
  }

  signTypedData_v1(address, typedData, opts = {}) {
    // Waiting on trezor to enable this
    throw new Error('Not supported on this device');
  }

  // personal_signTypedData, signs data along with the schema
  signTypedData_v3_v4(
    address,
    typedData,
    opts: { version?: 'V3' | 'V4' } = {}
  ) {
    this.pendingSignings += 1;
    const cancellationVersion = this.cancellationVersion;
    return new Promise((resolve, reject) => {
      const isV4 = opts.version === 'V4';
      const {
        domain,
        types,
        primaryType,
        message,
      } = sigUtil.TypedDataUtils.sanitizeData(typedData);
      const domainSeparatorHex = sigUtil.TypedDataUtils.hashStruct(
        'EIP712Domain',
        domain,
        types,
        isV4
      ).toString('hex');
      const hashStructMessageHex = sigUtil.TypedDataUtils.hashStruct(
        primaryType as string,
        message,
        types,
        isV4
      ).toString('hex');
      this.unlock()
        .then((status) => {
          setTimeout(
            (_) => {
              if (cancellationVersion !== this.cancellationVersion) {
                reject(new Error('OneKey signing cancelled'));
                return;
              }
              try {
                const params = {
                  path: this._pathFromAddress(address),
                  data: typedData,
                  passphraseState: this.passphraseState,
                  useEmptyPassphrase: this._isEmptyPassphrase(
                    this.passphraseState
                  ),
                  metamaskV4Compat: isV4,
                  domainHash: domainSeparatorHex,
                  messageHash: hashStructMessageHex,
                  chainId: domain.chainId ? Number(domain.chainId) : undefined,
                };
                this._withPassphraseRecovery(address, params, (p) =>
                  this.bridge.evmSignTypedData(
                    this.connectId!,
                    this.deviceId!,
                    p as any
                  )
                )
                  .then((response) => {
                    if (cancellationVersion !== this.cancellationVersion) {
                      reject(new Error('OneKey signing cancelled'));
                      return;
                    }
                    if (response.success) {
                      const signature = `0x${response.payload.signature}`;
                      let recovered: string;
                      try {
                        recovered = isV4
                          ? sigUtil.recoverTypedSignature_v4({
                              data: typedData,
                              sig: signature,
                            })
                          : sigUtil.recoverTypedSignature({
                              data: typedData,
                              sig: signature,
                            });
                      } catch (e) {
                        this.cleanUp();
                        reject(toError(e));
                        return;
                      }
                      if (!isSameAddress(recovered, address)) {
                        this.cleanUp();
                        reject(
                          new Error('signature doesnt match the right address')
                        );
                        return;
                      }
                      resolve(signature);
                    } else {
                      let code =
                        (response.payload && response.payload.code) || '';
                      const message =
                        (response.payload && response.payload.error) || '';
                      let errorMsg =
                        (response.payload && response.payload.error) ||
                        'Unknown error';

                      let errorUrl = '';
                      if (message.includes('EIP712Domain')) {
                        code = 'EIP712_DOMAIN_NOT_SUPPORT';
                      } else if (message.includes('EIP712')) {
                        code = 'EIP712_BLIND_SIGN_DISABLED';
                        errorUrl =
                          'https://help.onekey.so/hc/zh-cn/articles/4406637762959';
                      }
                      if (code === 'Failure_UnexpectedMessage') {
                        code = 'EIP712_FIRMWARE_NOT_SUPPORT';
                        errorMsg = 'Not supported on this device';
                      }

                      const error =
                        typeof code === 'string' && code.startsWith('EIP712_')
                          ? Object.assign(
                              new Error(JSON.stringify({ code, errorMsg })),
                              { code: response.payload.code }
                            )
                          : toError(response.payload);
                      reject(error);
                      return;
                    }
                  })
                  .catch((e) => {
                    console.log('Error while trying to sign a message ', e);
                    reject(toError(e));
                    return;
                  });
              } catch (e) {
                reject(toError(e));
                return;
              }
              // This is necessary to avoid popup collision
              // between the unlock & sign trezor popups
            },
            status === 'just unlocked' ? DELAY_BETWEEN_POPUPS : 0
          );
        })
        .catch((e) => {
          console.log('Error while trying to sign a message ', e);
          reject(toError(e));
          return;
        });
    }).finally(() => {
      this.pendingSignings -= 1;
    });
  }

  exportAccount(): Promise<any> {
    return Promise.reject(new Error('Not supported on this device'));
  }

  forgetDevice(): void {
    this.accounts = [];
    this.cleanUp();
    this.page = 0;
    this.unlockedAccount = 0;
    this.paths = {};
  }

  /* PRIVATE METHODS */

  _normalize(buf: Buffer): string {
    return bufferToHex(buf);
  }

  // eslint-disable-next-line no-shadow
  _addressFromIndex(pathBase: string, i: number): string {
    const dkey = this.hdk.derive(`${pathBase}/${i}`);
    const address = bufferToHex(publicToAddress(dkey.publicKey, true));
    return toChecksumAddress(address);
  }

  _pathFromAddress(address: string): string {
    return `${this.hdPath}/${this.indexFromAddress(address)}`;
  }

  indexFromAddress(address: string) {
    const checksummedAddress = toChecksumAddress(address);
    let index =
      this.paths[checksummedAddress] ||
      this.accountDetails[checksummedAddress]?.index;

    if (typeof index === 'undefined') {
      for (let i = 0; i < MAX_INDEX; i++) {
        if (checksummedAddress === this._addressFromIndex(pathBase, i)) {
          index = i;
          break;
        }
      }
    }

    if (typeof index === 'undefined') {
      throw new Error('Unknown address');
    }
    return index;
  }

  async getCurrentAccounts() {
    await this.unlock();
    const addresses = await this.getAccounts();
    const currentPublicKey = this.getPathBasePublicKey();
    const accounts: Account[] = [];

    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];
      await this._fixAccountDetail(address);

      const detail = this.accountDetails[toChecksumAddress(address)];

      if (detail?.hdPathBasePublicKey !== currentPublicKey) {
        continue;
      }

      try {
        const account = {
          address,
          index: this.indexFromAddress(address) + 1,
        };
        accounts.push(account);
      } catch (e) {
        console.log('address not found', address);
      }
    }

    return accounts;
  }

  private getPathBasePublicKey() {
    return this.hdk.publicKey.toString('hex');
  }

  private async _fixAccountDetail(address: string) {
    const checksummedAddress = toChecksumAddress(address);
    const detail = this.accountDetails[checksummedAddress];

    // The detail is already fixed
    if (detail?.hdPathBasePublicKey && detail.hdPath) {
      return;
    }

    let addressInDevice;
    let index;

    try {
      index = this.indexFromAddress(address);
      addressInDevice = this._addressFromIndex(pathBase, index);
    } catch (e) {
      console.log('address not found', address);
    }

    if (!addressInDevice || !isSameAddress(address, addressInDevice)) {
      return;
    }

    this.accountDetails[checksummedAddress] = {
      ...detail,
      index,
      hdPath: this._pathFromAddress(address),
      hdPathType: LedgerHDPathType.BIP44,
      hdPathBasePublicKey: this.getPathBasePublicKey(),
    };
  }

  /**
   * SDK 1.2.7 `openWalletSession({ mode: 'select-hidden' })` still reports
   * walletType "hidden" when the user enters an empty passphrase on a Pro 2,
   * and the passphraseState is the standard wallet's btc_test_address. Compare
   * that identity with a useEmptyPassphrase probe and, if they match, treat the
   * session as the standard wallet so the id is never persisted. The probe runs
   * only for an ambiguous V2 session (hidden type + non-empty state). A failed
   * probe keeps the hidden id so import can still proceed.
   */
  private async _resolvePassphraseStateForImport({
    connectId,
    protocol,
    walletType,
    passphraseState,
  }: {
    connectId: string;
    protocol?: string;
    walletType?: 'standard' | 'hidden';
    passphraseState?: string | null;
  }): Promise<string | undefined> {
    if (walletType === 'standard') {
      return undefined;
    }
    const imported = passphraseState || undefined;
    if (this._isEmptyPassphrase(imported)) {
      return undefined;
    }
    if (protocol !== 'V2') {
      return imported;
    }
    const standardIdentity = await this._getStandardWalletIdentity(connectId);
    if (standardIdentity && standardIdentity === imported) {
      return undefined;
    }
    return imported;
  }

  private async _getStandardWalletIdentity(
    connectId: string
  ): Promise<string | undefined> {
    try {
      const result = await this.bridge.getPassphraseState(connectId, {
        useEmptyPassphrase: true,
      });
      if (
        result?.success &&
        typeof result.payload === 'string' &&
        result.payload
      ) {
        return result.payload;
      }
    } catch (e) {
      console.log('failed to read OneKey standard wallet identity', e);
    }
    return undefined;
  }

  private _isEmptyPassphrase(passphraseState: string | undefined | null) {
    return (
      passphraseState === null ||
      passphraseState === undefined ||
      passphraseState === ''
    );
  }
}

export default OneKeyKeyring;
