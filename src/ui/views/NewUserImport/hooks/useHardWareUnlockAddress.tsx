import { KEYRING_CLASS } from '@/constant';
import { useNewUserGuideStore } from './useNewUserGuideStore';
import { useWallet } from '@/ui/utils';
import React from 'react';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';

export const useHDWalletUnlockAndRedirect = (
  type: typeof KEYRING_CLASS.HARDWARE[keyof typeof KEYRING_CLASS.HARDWARE]
) => {
  const { t } = useTranslation();

  const { store, setStore } = useNewUserGuideStore();
  const wallet = useWallet();
  const idRef = React.useRef<number | null>(null);
  const history = useHistory();
  const pendingRef = React.useRef<Promise<void>>();
  const activeRef = React.useRef(false);
  const generationRef = React.useRef(0);

  React.useEffect(() => {
    activeRef.current = true;
    if (type !== KEYRING_CLASS.HARDWARE.ONEKEY) return;
    const cancel = () => {
      activeRef.current = false;
      generationRef.current += 1;
      const id = idRef.current;
      idRef.current = null;
      if (id !== null) {
        void wallet
          .requestKeyring(type, 'cleanUp', id, true)
          .catch(console.error);
      }
    };
    window.addEventListener('beforeunload', cancel);
    return () => {
      window.removeEventListener('beforeunload', cancel);
      cancel();
    };
  }, [type]);

  return React.useCallback(async () => {
    if (type === KEYRING_CLASS.HARDWARE.ONEKEY) {
      if (pendingRef.current) return pendingRef.current;
      pendingRef.current = (async () => {
        const generation = generationRef.current;
        const isActive = () =>
          activeRef.current && generationRef.current === generation;
        try {
          // Obtain the id before PIN/passphrase interaction so closing can cancel it.
          const id = await wallet.connectHardware({ type, isWebHID: true });
          if (!isActive()) {
            await wallet.requestKeyring(type, 'cleanUp', id, true);
            return;
          }
          idRef.current = id;
          const accounts = await wallet.requestKeyring(
            type,
            'getAddresses',
            id,
            0,
            1
          );
          if (!isActive() || !accounts?.length) return;
          setStore({ clearKeyringId: id });
          // The address manager now owns this keyring and its cleanup.
          idRef.current = null;
          history.push({
            pathname: '/new-user/import/select-address',
            search: `?hd=${encodeURIComponent(
              type
            )}&keyringId=${id}&isLazyImport=true&isNewUserImport=true`,
          });
        } catch (error) {
          if (isActive() && error?.name !== 'NotFoundError') {
            message.error({
              content:
                error.message || t('page.newAddress.hd.tooltip.connectError'),
              key: 'ledger-error',
            });
          }
        }
      })().finally(() => {
        pendingRef.current = undefined;
      });
      return pendingRef.current;
    }
    await wallet
      .connectHardware({
        type: type,
        isWebHID: true,
        // needUnlock: type === KEYRING_CLASS.HARDWARE.GRIDPLUS,
        needUnlock: true,
      })
      .then((id) => {
        idRef.current = id;
      })
      .catch((e) => {
        console.error(e);
        message.error({
          content: t('page.newAddress.hd.tooltip.disconnected'),
          key: 'ledger-error',
        });
      });

    try {
      const accounts = await wallet.requestKeyring(
        type,
        'getAddresses',
        idRef.current,
        0,
        1
      );

      if (accounts && accounts.length) {
        // await wallet.boot(store.password);
        // await wallet.unlockHardwareAccount(
        //   type,
        //   [accounts[0].index - 1],
        //   idRef.current
        // );

        setStore({
          clearKeyringId: idRef.current!,
        });

        history.push({
          pathname: '/new-user/import/select-address',
          search: `?hd=${encodeURIComponent(type)}&keyringId=${
            idRef.current
          }&isLazyImport=true&isNewUserImport=true`,
        });
      }
    } catch (error) {
      console.error(error);
      message.error({
        content: t('page.newAddress.hd.tooltip.disconnected'),
        key: 'ledger-error',
      });
    }
  }, [
    t,
    setStore,
    wallet?.connectHardware,
    wallet?.requestKeyring,
    wallet?.getAlianName,
    wallet?.boot,
    store?.password,
    wallet?.unlockHardwareAccount,
  ]);
};
