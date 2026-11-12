import type { CoreApi } from '@onekeyfe/hd-core';

export interface OneKeyBridgeInterface {
  init: () => Promise<void>;
  cancel: (connectId?: string) => void | Promise<void>;
  evmSignTransaction: CoreApi['evmSignTransaction'];
  evmSignMessage: CoreApi['evmSignMessage'];
  evmSignTypedData: CoreApi['evmSignTypedData'];
  searchDevices: CoreApi['searchDevices'];
  getDeviceState: CoreApi['getDeviceState'];
  getPassphraseState: CoreApi['getPassphraseState'];
  openWalletSession?: CoreApi['openWalletSession'];
  evmGetPublicKey: CoreApi['evmGetPublicKey'];
}
