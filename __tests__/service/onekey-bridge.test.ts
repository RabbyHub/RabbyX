import {
  bufferToHex,
  privateToPublic,
  publicToAddress,
  toChecksumAddress,
} from '@ethereumjs/util';
import * as sigUtil from 'eth-sig-util';
import { Transaction } from '@ethereumjs/tx';
const mockBrowser = {
  storage: { session: { get: jest.fn(), set: jest.fn() } },
  runtime: { sendMessage: jest.fn() },
};
const sendMessageMock = mockBrowser.runtime.sendMessage;
const storageSessionGetMock = mockBrowser.storage.session.get;

// jsdom installs its own Uint8Array, so Node's Buffer fails
// `instanceof Uint8Array` inside @noble/secp256k1. Align the globals.
const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
(global as any).Uint8Array = NodeUint8Array;

const mockSdk = {
  init: jest.fn(),
  cancel: jest.fn(),
  on: jest.fn(),
  uiResponse: jest.fn(),
  evmSignTransaction: jest.fn(),
  evmSignMessage: jest.fn(),
  evmSignTypedData: jest.fn(),
  searchDevices: jest.fn(),
  getDeviceState: jest.fn(),
  getPassphraseState: jest.fn(),
  openWalletSession: jest.fn(),
  evmGetPublicKey: jest.fn(),
};

jest.mock('@onekeyfe/hd-web-sdk', () => ({
  __esModule: true,
  default: { HardwareWebSdk: mockSdk },
}));
jest.mock('@onekeyfe/hd-core', () => ({
  UI_EVENT: 'UI_EVENT',
  UI_REQUEST: { REQUEST_PIN: 'PIN', REQUEST_PASSPHRASE: 'PASSPHRASE' },
  UI_RESPONSE: {
    RECEIVE_PIN: 'PIN_RESPONSE',
    RECEIVE_PASSPHRASE: 'PASSPHRASE_RESPONSE',
  },
}));
jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('@/utils/env', () => ({ isManifestV3: false }));
jest.mock('@/constant', () => ({ EVENTS: {} }));
jest.mock('@/eventBus', () => ({ emit: jest.fn() }));
jest.mock('webextension-polyfill', () => mockBrowser);
jest.mock('@/background/utils', () => ({
  isSameAddress: (first: string, second: string) =>
    first.toLowerCase() === second.toLowerCase(),
}));

const publicKey =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
// Private key 1 owns the generator public key above.
const privateKey = Buffer.from(`${'00'.repeat(31)}01`, 'hex');
const accountAddress = toChecksumAddress(
  bufferToHex(publicToAddress(privateToPublic(privateKey), true))
);

describe('OneKey SDK bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockSdk.init.mockResolvedValue(true);
  });

  function createBridge() {
    const Bridge = jest.requireActual(
      '@/background/service/keyring/eth-onekey-keyring/onekey-bridge'
    ).default;
    return new Bridge();
  }

  it('waits for initialization and registers one listener across bridge instances', async () => {
    const first = createBridge();
    const second = createBridge();
    await Promise.all([first.init(), second.init()]);

    expect(mockSdk.init).toHaveBeenCalledTimes(1);
    expect(mockSdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'desktop-webusb',
        fetchConfig: true,
        connectSrc: 'https://jssdk.onekey.so/1.2.8/',
      })
    );
    expect(mockSdk.on).toHaveBeenCalledTimes(1);
  });

  it('forwards device-scoped cancellation through the offscreen bridge', async () => {
    sendMessageMock.mockResolvedValue({ success: true });
    const Bridge = jest.requireActual(
      '@/background/service/keyring/eth-onekey-keyring/onekey-offscreen-bridge'
    ).default;
    await new Bridge().cancel('usb-path');
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'onekey-cancel', params: ['usb-path'] })
    );
    sendMessageMock.mockRejectedValueOnce(new Error('Offscreen closed'));
    await expect(new Bridge().cancel('usb-path')).rejects.toThrow(
      'Offscreen closed'
    );
  });

  it('reports failed SDK initialization and permits another attempt', async () => {
    mockSdk.init.mockResolvedValueOnce(false);
    const bridge = createBridge();
    await expect(bridge.init()).rejects.toThrow(
      'OneKey SDK initialization failed'
    );
    await expect(bridge.init()).resolves.toBeUndefined();
  });

  it('responds to V1 PIN with the exact correlation and leaves V2 PIN hints unanswered', async () => {
    await createBridge().init();
    const listener = mockSdk.on.mock.calls[0][1];
    const responseCorrelation = {
      interactionId: 'interaction',
      deviceId: 'device',
    };
    listener({ type: 'PIN', payload: { responseCorrelation } });
    expect(mockSdk.uiResponse).toHaveBeenCalledWith({
      ...responseCorrelation,
      type: 'PIN_RESPONSE',
      payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
    });

    mockSdk.uiResponse.mockClear();
    listener({ type: 'PIN', payload: { deviceOnly: true } });
    listener({ type: 'PIN', payload: { interaction: { protocol: 'V2' } } });
    expect(mockSdk.uiResponse).not.toHaveBeenCalled();
  });

  it('preserves correlation when selecting on-device passphrase input', async () => {
    await createBridge().init();
    const responseCorrelation = {
      interactionId: 'interaction',
      deviceId: 'device',
    };
    mockSdk.on.mock.calls[0][1]({
      type: 'PASSPHRASE',
      payload: { responseCorrelation },
    });
    expect(mockSdk.uiResponse).toHaveBeenCalledWith({
      ...responseCorrelation,
      type: 'PASSPHRASE_RESPONSE',
      payload: { value: '', passphraseOnDevice: true, save: true },
    });
  });
});

describe('OneKey offscreen bridge relays', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function createOffscreenBridge() {
    const Bridge = jest.requireActual(
      '@/background/service/keyring/eth-onekey-keyring/onekey-offscreen-bridge'
    ).default;
    return new Bridge();
  }

  it('rejects when the offscreen document is not ready', async () => {
    sendMessageMock.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    );

    await expect(createOffscreenBridge().init()).rejects.toThrow(
      'Could not establish connection. Receiving end does not exist.'
    );
  });

  it('rebuilds an Error with message and code from an offscreen failure', async () => {
    sendMessageMock.mockResolvedValueOnce({
      error: 'Device not opened passphrase',
      code: 113,
    });

    const error = await createOffscreenBridge()
      .evmSignMessage('usb-path', 'device-id', {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Device not opened passphrase');
    expect((error as any).code).toBe(113);
  });

  it('passes normal SDK results through unchanged', async () => {
    const result = { success: true, payload: { protocol: 'V2' } };
    sendMessageMock.mockResolvedValueOnce(result);

    await expect(
      createOffscreenBridge().getDeviceState('usb-path')
    ).resolves.toBe(result);
  });
});

describe('OneKey offscreen error serialization', () => {
  let serializeError: (err: unknown) => { error: string; code?: unknown };

  beforeAll(() => {
    ({ serializeError } = jest.requireActual('@/offscreen/scripts/onekey'));
  });

  it('serializes an Error with its code', () => {
    const error = new Error('Device not opened passphrase') as Error & {
      code: number;
    };
    error.code = 113;

    expect(serializeError(error)).toEqual({
      error: 'Device not opened passphrase',
      code: 113,
    });
  });

  it('serializes a string rejection', () => {
    expect(serializeError('searchDevices failed')).toEqual({
      error: 'searchDevices failed',
      code: undefined,
    });
  });

  it('serializes a typed-error-like object with errorCode', () => {
    expect(
      serializeError({ message: 'Passphrase disabled', errorCode: 'Failure' })
    ).toEqual({ error: 'Passphrase disabled', code: 'Failure' });
  });
});

describe('OneKey V1/V2 account import', () => {
  function setup(
    protocol: 'V1' | 'V2',
    passphraseState?: string,
    status?: { passphraseProtection?: boolean },
    options: { openWalletSession?: boolean } = {}
  ) {
    const bridge: any = {
      init: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
      evmSignMessage: jest.fn(),
      evmSignTypedData: jest.fn(),
      evmSignTransaction: jest.fn(),
      searchDevices: jest.fn().mockResolvedValue({
        success: true,
        payload: [{ connectId: 'usb-path', deviceId: 'legacy-projection' }],
      }),
      getDeviceState: jest.fn().mockResolvedValue({
        success: true,
        payload: {
          protocol,
          identity: { deviceId: 'authoritative-device-id' },
          ...(status ? { status } : {}),
        },
      }),
      getPassphraseState: jest
        .fn()
        .mockImplementation(
          async (
            _connectId: string,
            params?: { useEmptyPassphrase?: boolean }
          ) => ({
            success: true,
            payload: params?.useEmptyPassphrase
              ? 'standard-wallet-id'
              : passphraseState,
          })
        ),
      evmGetPublicKey: jest.fn().mockResolvedValue({
        success: true,
        payload: { pub: publicKey, node: { chain_code: '11'.repeat(32) } },
      }),
    };
    if (protocol === 'V2' && options.openWalletSession !== false) {
      bridge.openWalletSession = jest
        .fn()
        .mockImplementation(
          async (
            _connectId: string,
            params: { mode: 'standard' | 'select-hidden' }
          ) => {
            if (params.mode === 'standard') {
              return {
                success: true,
                payload: {
                  protocol,
                  deviceId: 'authoritative-device-id',
                  resumed: false,
                  walletType: 'standard',
                  passphraseState: null,
                },
              };
            }
            return {
              success: true,
              payload: {
                protocol,
                deviceId: 'authoritative-device-id',
                resumed: false,
                walletType: 'hidden',
                passphraseState: passphraseState ?? null,
              },
            };
          }
        );
    }
    const Keyring = jest.requireActual(
      '@/background/service/keyring/eth-onekey-keyring/eth-onekey-keyring'
    ).default;
    return { bridge, keyring: new Keyring({ bridge }) };
  }

  it.each([
    ['V1', undefined],
    ['V1', 'hidden-wallet-token'],
  ] as const)(
    'imports %s with passphraseState %s using getPassphraseState',
    async (protocol, passphraseState) => {
      const { bridge, keyring } = setup(protocol, passphraseState);
      await expect(keyring.unlock()).resolves.toBe('just unlocked');
      expect(bridge.getDeviceState).toHaveBeenCalledWith('usb-path');
      expect(bridge.getPassphraseState).toHaveBeenCalledWith(
        'usb-path',
        undefined
      );
      expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
        'usb-path',
        'authoritative-device-id',
        expect.objectContaining({ passphraseState })
      );
      expect(keyring.hdk.publicKey.toString('hex')).toBe(publicKey);
    }
  );

  it.each([
    [801, 'pinInvalid'],
    [117, 'deviceBusy'],
    [107, 'deviceInterrupted'],
    [109, 'deviceInterrupted'],
    [822, 'actionCancel'],
    [802, 'actionCancel'],
    [115, 'notAllowInBootloaderMode'],
  ])('maps SDK code %s to %s', async (code, key) => {
    const { bridge, keyring } = setup('V1');
    bridge.getPassphraseState.mockResolvedValueOnce({
      success: false,
      payload: { code, error: 'SDK failure' },
    });
    await expect(keyring.unlock()).rejects.toMatchObject({
      code,
      message: `${code}: background.keyring.onekey.${key}`,
    });
  });

  it('selects the standard wallet on a V2 device with passphrase protection off', async () => {
    const { bridge, keyring } = setup('V2', 'bc1q-standard-wallet-session', {
      passphraseProtection: false,
    });
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.openWalletSession).toHaveBeenCalledTimes(1);
    expect(bridge.openWalletSession).toHaveBeenCalledWith('usb-path', {
      mode: 'standard',
    });
    expect(bridge.getPassphraseState).not.toHaveBeenCalled();
    expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        passphraseState: undefined,
        useEmptyPassphrase: true,
      })
    );
    expect(keyring.passphraseState).toBeUndefined();
  });

  it('shares concurrent unlock and address imports', async () => {
    const { bridge, keyring } = setup('V2');
    await Promise.all([
      keyring.unlock(),
      keyring.getAddresses(0, 1),
      keyring.getAddresses(1, 2),
    ]);
    expect(bridge.searchDevices).toHaveBeenCalledTimes(1);
    expect(bridge.getDeviceState).toHaveBeenCalledTimes(1);
    expect(bridge.openWalletSession).toHaveBeenCalledTimes(1);
    expect(bridge.evmGetPublicKey).toHaveBeenCalledTimes(1);
  });

  it.each([
    'getDeviceState',
    'openWalletSession',
    'getPassphraseState',
    'evmGetPublicKey',
  ])('cancels import during %s and ignores late success', async (stage) => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token');
    const response = await bridge[stage]('usb-path', { mode: 'select-hidden' });
    bridge[stage].mockClear();
    let finish!: (value: any) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    bridge[stage].mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const importing = keyring.getAddresses(0, 1);
    const rejected = expect(importing).rejects.toThrow(
      'OneKey signing cancelled'
    );
    await waiting;
    await keyring.cleanUp(true);
    expect(bridge.cancel).toHaveBeenCalledWith('usb-path');
    finish(response);
    await rejected;
    expect(keyring.isUnlocked()).toBe(false);
    if (stage !== 'evmGetPublicKey') {
      expect(bridge.evmGetPublicKey).not.toHaveBeenCalled();
    }
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
  });

  it('does not cancel an SDK operation after an import has completed', async () => {
    const { bridge, keyring } = setup('V2');
    await keyring.unlock();
    await keyring.cleanUp(true);
    expect(bridge.cancel).not.toHaveBeenCalled();
    expect(keyring.isUnlocked()).toBe(false);
  });

  it('allows retry after a thrown unlock failure and keeps errorCode', async () => {
    const { bridge, keyring } = setup('V2');
    bridge.searchDevices.mockRejectedValueOnce(
      Object.assign(new Error('Disconnected'), { errorCode: 107 })
    );
    await expect(keyring.unlock()).rejects.toMatchObject({ code: 107 });
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
  });

  it.each([
    'searchDevices',
    'getDeviceState',
    'openWalletSession',
    'evmGetPublicKey',
  ])('preserves returned SDK errors from %s', async (stage) => {
    const { bridge, keyring } = setup('V2');
    bridge[stage].mockResolvedValueOnce({
      success: false,
      payload: { code: 800, error: 'SDK failure' },
    });
    await expect(keyring.unlock()).rejects.toMatchObject({
      code: 800,
      message: '800: SDK failure',
    });
  });

  it('keeps the hidden wallet passphraseState on a V2 device with passphrase on', async () => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token', {
      passphraseProtection: true,
    });
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.openWalletSession).toHaveBeenCalledWith('usb-path', {
      mode: 'select-hidden',
    });
    expect(bridge.getPassphraseState).toHaveBeenCalledWith('usb-path', {
      useEmptyPassphrase: true,
    });
    expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        passphraseState: 'hidden-wallet-token',
        useEmptyPassphrase: false,
      })
    );
    expect(keyring.passphraseState).toBe('hidden-wallet-token');
  });

  it('treats an empty passphrase in select-hidden as the standard wallet', async () => {
    const { bridge, keyring } = setup('V2', 'standard-wallet-id', {
      passphraseProtection: true,
    });
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.openWalletSession).toHaveBeenCalledWith('usb-path', {
      mode: 'select-hidden',
    });
    expect(bridge.getPassphraseState).toHaveBeenCalledWith('usb-path', {
      useEmptyPassphrase: true,
    });
    expect(keyring.passphraseState).toBeUndefined();
    expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        passphraseState: undefined,
        useEmptyPassphrase: true,
      })
    );
  });

  it('keeps a real hidden wallet whose passphraseState differs from the standard identity', async () => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token', {
      passphraseProtection: true,
    });
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.getPassphraseState).toHaveBeenCalledWith('usb-path', {
      useEmptyPassphrase: true,
    });
    expect(keyring.passphraseState).toBe('hidden-wallet-token');
  });

  it('keeps the hidden wallet when the standard-identity probe fails', async () => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token', {
      passphraseProtection: true,
    });
    bridge.getPassphraseState.mockRejectedValueOnce(new Error('probe failed'));
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(keyring.passphraseState).toBe('hidden-wallet-token');
  });

  it('does not store the standard wallet id when passphrase protection is on', async () => {
    const { bridge, keyring } = setup('V2', 'standard-wallet-id', {
      passphraseProtection: true,
    });
    bridge.openWalletSession.mockResolvedValueOnce({
      success: true,
      payload: { walletType: 'standard', passphraseState: null },
    });

    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.openWalletSession).toHaveBeenCalledWith('usb-path', {
      mode: 'select-hidden',
    });
    expect(keyring.passphraseState).toBeUndefined();
    expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        passphraseState: undefined,
        useEmptyPassphrase: true,
      })
    );
  });

  it.each([
    { error: 'OneKey action not supported' },
    { code: 'MethodNotAllowed' },
    { code: 'Method not found' },
    { errorCode: 'MethodNotAllowed' },
    { code: -32601, error: 'Method not found' },
    { code: 'MethodNotFound' },
  ])(
    'falls back to getPassphraseState for unsupported sessions: %j',
    async (payload) => {
      const { bridge, keyring } = setup('V2', 'legacy-wallet-token');
      bridge.openWalletSession.mockResolvedValueOnce({
        success: false,
        payload,
      });

      await expect(keyring.unlock()).resolves.toBe('just unlocked');
      expect(bridge.getPassphraseState).toHaveBeenCalledWith(
        'usb-path',
        undefined
      );
      expect(keyring.passphraseState).toBe('legacy-wallet-token');
    }
  );

  it('falls back when the offscreen bridge throws an unsupported-method Error', async () => {
    const { bridge, keyring } = setup('V2', 'standard-wallet-id', {
      passphraseProtection: false,
    });
    bridge.openWalletSession.mockRejectedValueOnce(
      Object.assign(new Error('Method not found'), { code: -32601 })
    );

    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.getPassphraseState).toHaveBeenCalledWith('usb-path', {
      useEmptyPassphrase: true,
    });
    expect(keyring.passphraseState).toBeUndefined();
  });

  it('retries with the standard wallet when select-hidden fails with 113', async () => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token', {
      passphraseProtection: true,
    });
    bridge.openWalletSession
      .mockResolvedValueOnce({
        success: false,
        payload: { error: 'Passphrase disabled', code: 113 },
      })
      .mockResolvedValueOnce({
        success: true,
        payload: {
          protocol: 'V2',
          deviceId: 'authoritative-device-id',
          resumed: false,
          walletType: 'standard',
          passphraseState: null,
        },
      });

    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.openWalletSession).toHaveBeenNthCalledWith(1, 'usb-path', {
      mode: 'select-hidden',
    });
    expect(bridge.openWalletSession).toHaveBeenNthCalledWith(2, 'usb-path', {
      mode: 'standard',
    });
    expect(bridge.evmGetPublicKey).toHaveBeenCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        passphraseState: undefined,
        useEmptyPassphrase: true,
      })
    );
    expect(keyring.passphraseState).toBeUndefined();
  });

  it('keeps the legacy getPassphraseState flow when openWalletSession is unavailable', async () => {
    const { bridge, keyring } = setup(
      'V2',
      'hidden-wallet-token',
      { passphraseProtection: true },
      { openWalletSession: false }
    );
    await expect(keyring.unlock()).resolves.toBe('just unlocked');
    expect(bridge.getPassphraseState).toHaveBeenCalledWith(
      'usb-path',
      undefined
    );
    expect(keyring.passphraseState).toBe('hidden-wallet-token');
  });

  it('rejects unlock failures with an Error that carries the device message', async () => {
    const { bridge, keyring } = setup('V2', 'hidden-wallet-token', {
      passphraseProtection: true,
    });
    bridge.openWalletSession.mockResolvedValueOnce({
      success: false,
      payload: { error: 'Some wallet session failure', code: 800 },
    });
    const error = await keyring.unlock().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: 800,
      message: '800: Some wallet session failure',
    });
    expect((error as any).code).toBe(800);
    expect(bridge.getPassphraseState).not.toHaveBeenCalled();
    expect(bridge.evmGetPublicKey).not.toHaveBeenCalled();
  });

  it('preserves the message and code of a rejected offscreen call', async () => {
    const { bridge, keyring } = setup('V2');
    const error = Object.assign(new Error('Device disconnected'), {
      code: 100,
    });
    bridge.openWalletSession.mockRejectedValueOnce(error);
    await expect(keyring.unlock()).rejects.toBe(error);
    expect(bridge.getPassphraseState).not.toHaveBeenCalled();
  });

  it('does not restore a cleared wallet cache on the next unlock', async () => {
    const env = jest.requireMock('@/utils/env');
    env.isManifestV3 = true;
    storageSessionGetMock.mockResolvedValue({
      onekeySessionState: {
        deviceId: 'authoritative-device-id',
        connectId: 'usb-path',
        publicKey,
        chainCode: '11'.repeat(32),
        passphraseState: 'old-wallet',
      },
    });
    try {
      const { keyring, bridge } = setup('V2', 'new-wallet', {
        passphraseProtection: true,
      });
      await keyring.init();
      keyring.cleanUp();
      expect(keyring.isUnlocked()).toBe(false);
      await expect(keyring.unlock()).resolves.toBe('just unlocked');
      expect(bridge.openWalletSession).toHaveBeenCalledTimes(1);
      expect(keyring.passphraseState).toBe('new-wallet');
    } finally {
      env.isManifestV3 = false;
    }
  });

  it('cancels a pending signing delay before sending a message to the device', async () => {
    jest.useFakeTimers();
    try {
      const { keyring, bridge } = setup('V2');
      keyring.unlock = jest.fn().mockResolvedValue('just unlocked');
      const signing = keyring.signPersonalMessage(
        '0x' + '11'.repeat(20),
        '0x01'
      );
      const rejected = expect(signing).rejects.toThrow(
        'OneKey signing cancelled'
      );
      await Promise.resolve();
      keyring.cancel();
      jest.runAllTimers();
      await rejected;
      expect(bridge.cancel).toHaveBeenCalled();
      expect(bridge.evmSignMessage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops before requesting wallet or public-key data when identity lookup fails', async () => {
    const { bridge, keyring } = setup('V2');
    bridge.getDeviceState.mockResolvedValue({
      success: false,
      payload: { error: 'Device disconnected', code: 100 },
    });
    await expect(keyring.unlock()).rejects.toBeTruthy();
    expect(bridge.getPassphraseState).not.toHaveBeenCalled();
    expect(bridge.openWalletSession).not.toHaveBeenCalled();
    expect(bridge.evmGetPublicKey).not.toHaveBeenCalled();
  });

  it('propagates a public-key transport rejection without leaving account import pending', async () => {
    const { bridge, keyring } = setup('V2');
    bridge.evmGetPublicKey.mockRejectedValue(new Error('USB disconnected'));
    await expect(keyring.unlock()).rejects.toThrow('USB disconnected');
  });
});

describe('OneKey passphrase recovery and signature address checks', () => {
  function setupSigning(
    protocol: 'V1' | 'V2' = 'V1',
    passphraseState?: string,
    status?: { passphraseProtection?: boolean }
  ) {
    const bridge: any = {
      init: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn(),
      evmSignMessage: jest.fn(),
      evmSignTypedData: jest.fn(),
      evmSignTransaction: jest.fn(),
      searchDevices: jest.fn().mockResolvedValue({
        success: true,
        payload: [{ connectId: 'usb-path', deviceId: 'legacy-projection' }],
      }),
      getDeviceState: jest.fn().mockResolvedValue({
        success: true,
        payload: {
          protocol,
          identity: { deviceId: 'authoritative-device-id' },
          ...(status ? { status } : {}),
        },
      }),
      getPassphraseState: jest
        .fn()
        .mockImplementation(
          async (
            _connectId: string,
            params?: { useEmptyPassphrase?: boolean }
          ) => ({
            success: true,
            payload: params?.useEmptyPassphrase
              ? 'standard-wallet-id'
              : passphraseState,
          })
        ),
      evmGetPublicKey: jest.fn().mockResolvedValue({
        success: true,
        payload: { pub: publicKey, node: { chain_code: '11'.repeat(32) } },
      }),
    };
    if (protocol === 'V2') {
      bridge.openWalletSession = jest.fn().mockResolvedValue({
        success: true,
        payload: {
          protocol,
          deviceId: 'authoritative-device-id',
          resumed: false,
          walletType: passphraseState ? 'hidden' : 'standard',
          passphraseState: passphraseState ?? null,
        },
      });
    }
    const Keyring = jest.requireActual(
      '@/background/service/keyring/eth-onekey-keyring/eth-onekey-keyring'
    ).default;
    return {
      bridge,
      keyring: new Keyring({
        bridge,
        accountDetails: {
          [accountAddress]: {
            hdPath: "m/44'/60'/0'/0/0",
            hdPathType: 'BIP44',
            index: 0,
            passphraseState,
          },
        },
      }),
    };
  }

  const message = `0x${Buffer.from('hello onekey').toString('hex')}`;
  const signature = sigUtil.personalSign(privateKey, { data: message });
  const signatureWithoutPrefix = signature.replace(/^0x/, '');

  it.each(['evmSignMessage', 'evmSignTypedData', 'evmSignTransaction'])(
    'cancels pending %s during UI cleanup and rejects late success',
    async (kind) => {
      const { bridge, keyring } = setupSigning('V1');
      await keyring.unlock();
      let finish!: (value: any) => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      bridge[kind].mockImplementationOnce(() => {
        entered();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const signing = signingCall(keyring, kind);
      const rejected = expect(signing).rejects.toThrow(
        'OneKey signing cancelled'
      );
      await waiting;
      await keyring.cleanUp(true);
      expect(bridge.cancel).toHaveBeenCalledWith('usb-path');
      finish({ success: true, payload: {} });
      await rejected;
      await keyring.cleanUp(true);
      expect(bridge.cancel).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['evmSignMessage', 'evmSignTypedData', 'evmSignTransaction'])(
    'preserves thrown and returned errors through %s',
    async (kind) => {
      const { bridge, keyring } = setupSigning('V1');
      await keyring.unlock();
      bridge[kind].mockRejectedValueOnce(
        Object.assign(new Error('USB interrupted'), { code: 109 })
      );
      await expect(signingCall(keyring, kind)).rejects.toMatchObject({
        code: 109,
        message: 'USB interrupted',
      });
      bridge[kind].mockResolvedValueOnce({
        success: false,
        payload: { code: 802, error: 'PIN cancelled' },
      });
      await expect(signingCall(keyring, kind)).rejects.toMatchObject({
        code: 802,
        message: '802: background.keyring.onekey.actionCancel',
      });
    }
  );

  it('accepts a lowercase device address when the recovered signer matches', async () => {
    const { bridge, keyring } = setupSigning('V1');
    await keyring.unlock();
    keyring.paths[accountAddress] = 0;
    bridge.evmSignMessage.mockResolvedValue({
      success: true,
      payload: {
        address: accountAddress.toLowerCase(),
        signature: signatureWithoutPrefix,
      },
    });

    await expect(
      keyring.signPersonalMessage(accountAddress, message)
    ).resolves.toBe(`0x${signatureWithoutPrefix}`);
  });

  it('rejects a signature whose signer does not match and never resolves it', async () => {
    const { bridge, keyring } = setupSigning('V1');
    await keyring.unlock();
    keyring.paths[accountAddress] = 0;
    const otherKey = Buffer.from('22'.repeat(32), 'hex');
    const otherSignature = sigUtil
      .personalSign(otherKey, { data: message })
      .replace(/^0x/, '');
    bridge.evmSignMessage.mockResolvedValue({
      success: true,
      payload: { address: accountAddress, signature: otherSignature },
    });

    const resolved = jest.fn();
    const cleanUp = jest.spyOn(keyring, 'cleanUp');
    await expect(
      keyring.signPersonalMessage(accountAddress, message).then(resolved)
    ).rejects.toThrow('signature doesnt match the right address');
    expect(resolved).not.toHaveBeenCalled();
    expect(cleanUp).toHaveBeenCalledTimes(1);
  });

  it('retries once with an empty passphrase when the standard wallet owns the account', async () => {
    const { bridge, keyring } = setupSigning('V2', 'stale-passphrase', {
      passphraseProtection: true,
    });
    await keyring.unlock();
    keyring.paths[accountAddress] = 0;
    keyring.accountDetails[accountAddress] = {
      hdPath: "m/44'/60'/0'/0/0",
      hdPathType: keyring.accountDetails[accountAddress]?.hdPathType,
      index: 0,
      passphraseState: 'stale-passphrase',
    };
    bridge.evmSignMessage
      .mockResolvedValueOnce({
        success: false,
        payload: { error: 'Device not opened passphrase', code: 113 },
      })
      .mockResolvedValueOnce({
        success: true,
        payload: {
          address: accountAddress.toLowerCase(),
          signature: signatureWithoutPrefix,
        },
      });

    await expect(
      keyring.signPersonalMessage(accountAddress, message)
    ).resolves.toBe(`0x${signatureWithoutPrefix}`);

    expect(bridge.evmSignMessage).toHaveBeenCalledTimes(2);
    expect(bridge.evmSignMessage.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        passphraseState: 'stale-passphrase',
        useEmptyPassphrase: false,
      })
    );
    expect(bridge.evmSignMessage.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        passphraseState: undefined,
        useEmptyPassphrase: true,
      })
    );
    expect(bridge.evmGetPublicKey).toHaveBeenLastCalledWith(
      'usb-path',
      'authoritative-device-id',
      expect.objectContaining({
        path: "m/44'/60'/0'/0/0",
        showOnOneKey: false,
        chainId: 1,
        useEmptyPassphrase: true,
      })
    );
    expect(keyring.passphraseState).toBeUndefined();
    expect(
      keyring.accountDetails[accountAddress].passphraseState
    ).toBeUndefined();
  });

  it('surfaces the original 113 when the standard wallet derives another address', async () => {
    const { bridge, keyring } = setupSigning('V2', 'stale-passphrase', {
      passphraseProtection: true,
    });
    await keyring.unlock();
    const hiddenKey = Buffer.from('33'.repeat(32), 'hex');
    const hiddenAddress = toChecksumAddress(
      bufferToHex(publicToAddress(privateToPublic(hiddenKey), true))
    );
    keyring.paths[hiddenAddress] = 1;
    bridge.evmSignMessage.mockResolvedValue({
      success: false,
      payload: { error: 'Device not opened passphrase', code: 113 },
    });

    await expect(
      keyring.signPersonalMessage(hiddenAddress, message)
    ).rejects.toMatchObject({
      message: '113: Device not opened passphrase',
      code: 113,
    });
    expect(bridge.evmSignMessage).toHaveBeenCalledTimes(1);
    expect(keyring.passphraseState).toBe('stale-passphrase');
  });

  const typedData: any = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Mail: [{ name: 'contents', type: 'string' }],
    },
    primaryType: 'Mail',
    domain: { name: 'Ether Mail', chainId: 1 },
    message: { contents: 'Hello OneKey' },
  };

  const disabled = {
    success: false,
    payload: { error: 'Device not opened passphrase', code: 113 },
  };

  function signingCall(keyring: any, kind: string) {
    if (kind === 'evmSignMessage') {
      return keyring.signPersonalMessage(accountAddress, message);
    }
    if (kind === 'evmSignTypedData') {
      return keyring.signTypedData(accountAddress, typedData, {
        version: 'V4',
      });
    }
    return keyring.signTransaction(accountAddress, transaction);
  }

  const transaction = Transaction.fromTxData({
    nonce: 0,
    gasPrice: 1,
    gasLimit: 21000,
    to: accountAddress,
    value: 1,
  });
  const signedTransaction = transaction.sign(privateKey);
  const transactionPayload = {
    v: signedTransaction.v!.toString(16),
    r: signedTransaction.r!.toString(16),
    s: signedTransaction.s!.toString(16),
  };

  it.each(['evmSignTypedData', 'evmSignTransaction'])(
    'recovers a stale session through %s with the same signing parameters',
    async (kind) => {
      const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
      await keyring.unlock();
      bridge.evmGetPublicKey.mockClear();
      const payload =
        kind === 'evmSignTypedData'
          ? {
              signature: sigUtil
                .signTypedData_v4(privateKey, { data: typedData })
                .slice(2),
            }
          : transactionPayload;
      bridge[kind].mockResolvedValueOnce(disabled).mockResolvedValueOnce({
        success: true,
        payload,
      });

      const result = await signingCall(keyring, kind);
      if (kind === 'evmSignTypedData') {
        expect(result).toBe(`0x${(payload as any).signature}`);
      } else {
        expect(result.serialize()).toEqual(signedTransaction.serialize());
      }
      expect(bridge[kind]).toHaveBeenCalledTimes(2);
      expect(bridge[kind].mock.calls[1][2]).toEqual({
        ...bridge[kind].mock.calls[0][2],
        passphraseState: undefined,
        useEmptyPassphrase: true,
      });
      expect(bridge.evmGetPublicKey).toHaveBeenCalledTimes(1);
      expect(keyring.passphraseState).toBeUndefined();
    }
  );

  it.each(['evmSignMessage', 'evmSignTypedData', 'evmSignTransaction'])(
    'retries %s at most once even if the retry also fails with 113',
    async (kind) => {
      const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
      await keyring.unlock();
      bridge.evmGetPublicKey.mockClear();
      bridge[kind].mockResolvedValue(disabled);

      await expect(signingCall(keyring, kind)).rejects.toThrow();
      expect(bridge[kind]).toHaveBeenCalledTimes(2);
      expect(bridge.evmGetPublicKey).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    [undefined, 113],
    ['stale-passphrase', 800],
  ])('does not recover state %s after error %s', async (state, code) => {
    const { keyring, bridge } = setupSigning('V2', state as string | undefined);
    await keyring.unlock();
    bridge.evmGetPublicKey.mockClear();
    bridge.evmSignMessage.mockResolvedValue({
      success: false,
      payload: { error: 'Signing failed', code },
    });

    await expect(signingCall(keyring, 'evmSignMessage')).rejects.toMatchObject({
      code,
    });
    expect(bridge.evmSignMessage).toHaveBeenCalledTimes(1);
    expect(bridge.evmGetPublicKey).not.toHaveBeenCalled();
    expect(keyring.passphraseState).toBe(state);
  });

  it('does not clear a global session that changed while checking the address', async () => {
    const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
    await keyring.unlock();
    bridge.evmGetPublicKey.mockImplementationOnce(async () => {
      keyring.passphraseState = 'another-session';
      return { success: true, payload: { pub: publicKey } };
    });
    bridge.evmSignMessage
      .mockResolvedValueOnce(disabled)
      .mockResolvedValueOnce({
        success: true,
        payload: { signature: signatureWithoutPrefix },
      });

    await expect(signingCall(keyring, 'evmSignMessage')).resolves.toBe(
      signature
    );
    expect(keyring.passphraseState).toBe('another-session');
    expect(
      keyring.accountDetails[accountAddress].passphraseState
    ).toBeUndefined();
  });

  it.each(['signing', 'address check', 'session persistence'])(
    'does not retry after cancellation during %s',
    async (stage) => {
      const env = jest.requireMock('@/utils/env');
      const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
      await keyring.unlock();
      bridge.evmGetPublicKey.mockClear();
      bridge.evmSignMessage.mockImplementationOnce(async () => {
        if (stage === 'signing') {
          keyring.cancel();
        }
        return disabled;
      });
      if (stage === 'address check') {
        bridge.evmGetPublicKey.mockImplementationOnce(async () => {
          keyring.cancel();
          return { success: true, payload: { pub: publicKey } };
        });
      }
      if (stage === 'session persistence') {
        env.isManifestV3 = true;
        storageSessionGetMock.mockImplementationOnce(async () => {
          keyring.cancel();
          return {
            onekeySessionState: { passphraseState: 'stale-passphrase' },
          };
        });
      }
      try {
        await expect(signingCall(keyring, 'evmSignMessage')).rejects.toThrow(
          'OneKey signing cancelled'
        );
        expect(bridge.evmSignMessage).toHaveBeenCalledTimes(1);
        expect(bridge.evmGetPublicKey).toHaveBeenCalledTimes(
          stage === 'signing' ? 0 : 1
        );
      } finally {
        env.isManifestV3 = false;
      }
    }
  );

  it.each([
    'failure',
    'transport rejection',
    'invalid key',
    'different address',
  ])(
    'keeps the original error and state after a public-key %s',
    async (failure) => {
      const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
      await keyring.unlock();
      bridge.evmSignMessage.mockResolvedValue(disabled);
      if (failure === 'transport rejection') {
        bridge.evmGetPublicKey.mockRejectedValueOnce(
          new Error('USB disconnected')
        );
      } else {
        bridge.evmGetPublicKey.mockResolvedValueOnce(
          failure === 'failure'
            ? { success: false, payload: { error: 'No device' } }
            : {
                success: true,
                payload: {
                  pub:
                    failure === 'invalid key'
                      ? 'invalid'
                      : bufferToHex(
                          privateToPublic(Buffer.from('22'.repeat(32), 'hex'))
                        ).slice(2),
                },
              }
        );
      }

      await expect(
        signingCall(keyring, 'evmSignMessage')
      ).rejects.toMatchObject({
        message: `113: ${disabled.payload.error}`,
        code: 113,
      });
      expect(bridge.evmSignMessage).toHaveBeenCalledTimes(1);
      expect(keyring.passphraseState).toBe('stale-passphrase');
      expect(keyring.accountDetails[accountAddress].passphraseState).toBe(
        'stale-passphrase'
      );
    }
  );

  it('persists a recovered standard-wallet session in MV3 storage', async () => {
    const { keyring, bridge } = setupSigning('V2', 'stale-passphrase');
    await keyring.unlock();
    const env = jest.requireMock('@/utils/env');
    const stored = {
      passphraseState: 'stale-passphrase',
      deviceId: keyring.deviceId,
      connectId: keyring.connectId,
      publicKey,
      chainCode: '11'.repeat(32),
    };
    env.isManifestV3 = true;
    storageSessionGetMock.mockResolvedValueOnce({ onekeySessionState: stored });
    mockBrowser.storage.session.set.mockClear();
    bridge.evmSignMessage
      .mockResolvedValueOnce(disabled)
      .mockResolvedValueOnce({
        success: true,
        payload: { signature: signatureWithoutPrefix },
      });
    try {
      await expect(signingCall(keyring, 'evmSignMessage')).resolves.toBe(
        signature
      );
      expect(mockBrowser.storage.session.set).toHaveBeenCalledWith({
        onekeySessionState: { ...stored, passphraseState: undefined },
      });
    } finally {
      env.isManifestV3 = false;
    }
  });

  it.each(['V3', 'V4'] as const)(
    'accepts a lowercase %s device address when the recovered signer matches',
    async (version) => {
      const { bridge, keyring } = setupSigning('V1');
      await keyring.unlock();
      keyring.paths[accountAddress] = 0;
      const sign =
        version === 'V4' ? sigUtil.signTypedData_v4 : sigUtil.signTypedData;
      const typedSignature = sign(privateKey, { data: typedData }).replace(
        /^0x/,
        ''
      );
      bridge.evmSignTypedData.mockResolvedValue({
        success: true,
        payload: {
          address: accountAddress.toLowerCase(),
          signature: typedSignature,
        },
      });

      await expect(
        keyring.signTypedData(accountAddress, typedData, { version })
      ).resolves.toBe(`0x${typedSignature}`);
    }
  );

  it.each(['V3', 'V4'] as const)(
    'rejects %s typed data signed by another account',
    async (version) => {
      const { bridge, keyring } = setupSigning('V1');
      await keyring.unlock();
      keyring.paths[accountAddress] = 0;
      const sign =
        version === 'V4' ? sigUtil.signTypedData_v4 : sigUtil.signTypedData;
      const otherSignature = sign(Buffer.from('22'.repeat(32), 'hex'), {
        data: typedData,
      }).replace(/^0x/, '');
      bridge.evmSignTypedData.mockResolvedValue({
        success: true,
        payload: {
          address: accountAddress,
          signature: otherSignature,
        },
      });

      const resolved = jest.fn();
      const cleanUp = jest.spyOn(keyring, 'cleanUp');
      await expect(
        keyring
          .signTypedData(accountAddress, typedData, { version })
          .then(resolved)
      ).rejects.toThrow('signature doesnt match the right address');
      expect(resolved).not.toHaveBeenCalled();
      expect(cleanUp).toHaveBeenCalledTimes(1);
    }
  );
});
