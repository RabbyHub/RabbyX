import { UI_EVENT, UI_REQUEST, UI_RESPONSE } from '@onekeyfe/hd-core';
import { OneKeyBridgeInterface } from './onekey-bridge-interface';
import HardwareSDK from '@onekeyfe/hd-web-sdk';
import webSdkPackage from '@onekeyfe/hd-web-sdk/package.json';
const { HardwareWebSdk } = HardwareSDK;
let initPromise: Promise<void> | undefined;

export default class OneKeyBridge implements OneKeyBridgeInterface {
  init: OneKeyBridgeInterface['init'] = () => {
    if (!initPromise) {
      initPromise = this.doInit().catch((error) => {
        initPromise = undefined;
        throw error;
      });
    }
    return initPromise;
  };

  private async doInit() {
    const initialized = await HardwareWebSdk.init({
      debug: false,
      env: 'desktop-webusb',
      fetchConfig: true,
      // Keep the iframe in lockstep with the bundled SDK version.
      connectSrc: `https://jssdk.onekey.so/${webSdkPackage.version}/`,
    });
    if (!initialized) {
      throw new Error('OneKey SDK initialization failed');
    }
    HardwareWebSdk.on(UI_EVENT, (e) => {
      switch (e.type) {
        case UI_REQUEST.REQUEST_PIN:
          if (
            e.payload.deviceOnly ||
            e.payload.interaction?.protocol === 'V2'
          ) {
            break;
          }
          HardwareWebSdk.uiResponse({
            ...e.payload.responseCorrelation,
            type: UI_RESPONSE.RECEIVE_PIN,
            payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
          });
          break;
        case UI_REQUEST.REQUEST_PASSPHRASE:
          HardwareWebSdk.uiResponse({
            ...e.payload.responseCorrelation,
            type: UI_RESPONSE.RECEIVE_PASSPHRASE,
            payload: {
              value: '',
              passphraseOnDevice: true,
              save: true,
            },
          });
          break;
        default:
        // NOTHING
      }
    });
  }

  evmSignTransaction = HardwareWebSdk.evmSignTransaction;

  evmSignMessage = HardwareWebSdk.evmSignMessage;

  evmSignTypedData = HardwareWebSdk.evmSignTypedData;

  cancel = HardwareWebSdk.cancel;

  searchDevices = HardwareWebSdk.searchDevices;

  getDeviceState = HardwareWebSdk.getDeviceState;

  getPassphraseState = HardwareWebSdk.getPassphraseState;

  openWalletSession = HardwareWebSdk.openWalletSession;

  evmGetPublicKey = HardwareWebSdk.evmGetPublicKey;
}
