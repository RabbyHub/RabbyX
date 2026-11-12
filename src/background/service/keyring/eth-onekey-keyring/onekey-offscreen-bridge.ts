import { OneKeyBridgeInterface } from './onekey-bridge-interface';
import browser from 'webextension-polyfill';
import {
  OffscreenCommunicationTarget,
  OneKeyAction,
} from '@/constant/offscreen-communication';

function toRelayError(res: { error?: unknown; code?: unknown }): Error {
  const raw = res.error;
  const message =
    typeof raw === 'string'
      ? raw
      : (raw as { message?: unknown } | null)?.message ?? String(raw);
  const error = new Error(String(message));
  if (res.code !== undefined) {
    (error as any).code = res.code;
  }
  return error;
}

export default class OneKeyOffscreenBridge implements OneKeyBridgeInterface {
  /**
   * Every offscreen call goes through this helper so a rejected
   * `runtime.sendMessage` (e.g. the offscreen document is not ready yet)
   * rejects the caller's promise instead of leaving it pending forever.
   */
  private async relay(action: OneKeyAction, params?: unknown[]) {
    const res = await browser.runtime.sendMessage({
      target: OffscreenCommunicationTarget.onekeyOffscreen,
      action,
      params,
    });
    if (
      res &&
      typeof res === 'object' &&
      'error' in res &&
      res.error !== undefined
    ) {
      throw toRelayError(res as { error?: unknown; code?: unknown });
    }
    return res;
  }

  cancel: OneKeyBridgeInterface['cancel'] = async (...params) => {
    await this.relay(OneKeyAction.cancel, params);
  };

  init: OneKeyBridgeInterface['init'] = async () => {
    await this.relay(OneKeyAction.init);
  };

  searchDevices: OneKeyBridgeInterface['searchDevices'] = () => {
    return this.relay(OneKeyAction.searchDevices) as any;
  };

  evmGetPublicKey: OneKeyBridgeInterface['evmGetPublicKey'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.evmGetPublicKey, params);
  };

  evmSignMessage: OneKeyBridgeInterface['evmSignMessage'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.evmSignMessage, params);
  };

  evmSignTransaction: OneKeyBridgeInterface['evmSignTransaction'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.evmSignTransaction, params);
  };

  evmSignTypedData: OneKeyBridgeInterface['evmSignTypedData'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.evmSignTypedData, params);
  };

  openWalletSession: OneKeyBridgeInterface['openWalletSession'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.openWalletSession, params);
  };

  getDeviceState: OneKeyBridgeInterface['getDeviceState'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.getDeviceState, params);
  };

  getPassphraseState: OneKeyBridgeInterface['getPassphraseState'] = (
    ...params
  ): any => {
    return this.relay(OneKeyAction.getPassphraseState, params);
  };
}
