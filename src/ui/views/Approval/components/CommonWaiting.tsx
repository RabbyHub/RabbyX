import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApproval, useCommonPopupView, useWallet } from 'ui/utils';
import {
  CHAINS,
  EVENTS,
  HARDWARE_KEYRING_TYPES,
  KEYRING_CATEGORY_MAP,
  WALLETCONNECT_STATUS_MAP,
  WALLET_BRAND_CONTENT,
  WALLET_BRAND_TYPES,
} from 'consts';
import {
  ApprovalPopupContainer,
  Props as ApprovalPopupContainerProps,
} from './Popup/ApprovalPopupContainer';
import { Account } from 'background/service/preference';
import stats from '@/stats';
import eventBus from '@/eventBus';
import { matomoRequestEvent } from '@/utils/matomo-request';
import { adjustV } from '@/ui/utils/gnosis';
import { message } from 'antd';
import { findChain } from '@/utils/chain';
import { emitSignComponentAmounted } from '@/utils/signEvent';
import { ga4 } from '@/utils/ga4';

interface ApprovalParams {
  address: string;
  chainId?: number;
  isGnosis?: boolean;
  data?: string[];
  account?: Account;
  $ctx?: any;
  extra?: Record<string, any>;
  type: string;
  safeMessage?: {
    safeMessageHash: string;
    safeAddress: string;
    message: string;
    chainId: number;
  };
}

export const CommonWaiting = ({ params }: { params: ApprovalParams }) => {
  const wallet = useWallet();
  const {
    setTitle,
    setVisible,
    closePopup,
    setPopupProps,
  } = useCommonPopupView();
  const [getApproval, resolveApproval, rejectApproval] = useApproval();
  const { t } = useTranslation();
  const { type } = params;
  const { brandName } = Object.keys(HARDWARE_KEYRING_TYPES)
    .map((key) => HARDWARE_KEYRING_TYPES[key])
    .find((item) => item.type === type);
  const [errorMessage, setErrorMessage] = React.useState('');
  const chain = findChain({
    id: params.chainId || 1,
  });
  const [connectStatus, setConnectStatus] = React.useState(
    WALLETCONNECT_STATUS_MAP.WAITING
  );
  const [result, setResult] = React.useState('');
  const [isClickDone, setIsClickDone] = React.useState(false);
  const [signFinishedData, setSignFinishedData] = React.useState<{
    data: any;
    approvalId: string;
  }>();
  const [statusProp, setStatusProp] = React.useState<
    ApprovalPopupContainerProps['status']
  >('SENDING');
  const [content, setContent] = React.useState('');
  const [description, setDescription] = React.useState('');
  const oneKeySigningRef = React.useRef(true);

  const handleRetry = async () => {
    if (connectStatus === WALLETCONNECT_STATUS_MAP.SUBMITTING) {
      message.success(t('page.signFooterBar.ledger.resubmited'));
      return;
    }
    const isOneKey = type === HARDWARE_KEYRING_TYPES.Onekey.type;
    if (isOneKey && oneKeySigningRef.current) return;
    if (isOneKey) oneKeySigningRef.current = true;
    try {
      await wallet.syncGetCurrentAccount();
      setConnectStatus(WALLETCONNECT_STATUS_MAP.WAITING);
      await wallet.resendSign();
      message.success(t('page.signFooterBar.ledger.resent'));
      emitSignComponentAmounted();
    } catch (error) {
      if (!isOneKey) throw error;
      oneKeySigningRef.current = false;
      setErrorMessage(error.message);
      setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILED);
    }
  };

  const handleCancel = () => {
    rejectApproval('user cancel');
  };

  const brandContent = React.useMemo(() => {
    switch (brandName) {
      case HARDWARE_KEYRING_TYPES.BitBox02.brandName:
        return WALLET_BRAND_CONTENT.BITBOX02;
      case HARDWARE_KEYRING_TYPES.GridPlus.brandName:
        return WALLET_BRAND_CONTENT.GRIDPLUS;
      case HARDWARE_KEYRING_TYPES.Onekey.brandName:
        return WALLET_BRAND_CONTENT.ONEKEY;
      case HARDWARE_KEYRING_TYPES.Trezor.brandName:
        return WALLET_BRAND_CONTENT.TREZOR;
      default:
        break;
    }
  }, [brandName]);

  const mountedRef = React.useRef(false);
  const subscriptionsRef = React.useRef<Array<() => void>>([]);

  const init = async () => {
    const account = params.isGnosis
      ? params.account!
      : (await wallet.syncGetCurrentAccount())!;
    const approval = await getApproval();
    if (!mountedRef.current || !approval) return;

    const isSignText = params.isGnosis
      ? true
      : approval?.data.approvalType !== 'SignTx';
    if (!isSignText) {
      const signingTxId = approval.data.params.signingTxId;
      if (signingTxId) {
        const signingTx = await wallet.getSigningTx(signingTxId);
        if (!mountedRef.current) return;

        if (!signingTx?.explain && chain && !chain?.isTestnet) {
          setErrorMessage(t('page.signFooterBar.qrcode.failedToGetExplain'));
          return;
        }

        const explain = signingTx?.explain;

        wallet.reportStats('signTransaction', {
          type: account.brandName,
          chainId: chain?.serverId || '',
          category: KEYRING_CATEGORY_MAP[account.type],
          preExecSuccess: explain
            ? explain?.calcSuccess && explain?.pre_exec.success
            : true,
          createdBy: params?.$ctx?.ga ? 'rabby' : 'dapp',
          source: params?.$ctx?.ga?.source || '',
          trigger: params?.$ctx?.ga?.trigger || '',
          networkType: chain?.isTestnet
            ? 'Custom Network'
            : 'Integrated Network',
        });
      }
    } else {
      stats.report('startSignText', {
        type: account.brandName,
        category: KEYRING_CATEGORY_MAP[account.type],
        method: params?.extra?.signTextMethod,
      });
    }

    const subscribe = (event: string, listener: (data?: any) => void) => {
      eventBus.addEventListener(event, listener);
      subscriptionsRef.current.push(() =>
        eventBus.removeEventListener(event, listener)
      );
    };

    subscribe(EVENTS.COMMON_HARDWARE.REJECTED, async (data) => {
      oneKeySigningRef.current = false;
      setErrorMessage(data);
      setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILED);
    });

    subscribe(EVENTS.TX_SUBMITTING, async () => {
      setConnectStatus(WALLETCONNECT_STATUS_MAP.SUBMITTING);
    });
    subscribe(EVENTS.SIGN_FINISHED, async (data) => {
      oneKeySigningRef.current = false;
      console.log('finished', data);
      if (data.success) {
        let sig = data.data;
        setResult(sig);
        setConnectStatus(WALLETCONNECT_STATUS_MAP.SUBMITTED);
        try {
          if (params.isGnosis) {
            sig = adjustV('eth_signTypedData', sig);
            const safeMessage = params.safeMessage;
            if (safeMessage) {
              await wallet.handleGnosisMessage({
                signature: data.data,
                signerAddress: params.account!.address!,
              });
            } else {
              const sigs = await wallet.getGnosisTransactionSignatures();
              if (sigs.length > 0) {
                await wallet.gnosisAddConfirmation(account.address, data.data);
              } else {
                await wallet.gnosisAddSignature(account.address, data.data);
                await wallet.postGnosisTransaction();
              }
            }
          }
        } catch (e) {
          setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILED);
          setErrorMessage(e.message);
          return;
        }
        matomoRequestEvent({
          category: 'Transaction',
          action: 'Submit',
          label: chain?.isTestnet ? 'Custom Network' : 'Integrated Network',
        });

        ga4.fireEvent(`Submit_${chain?.isTestnet ? 'Custom' : 'Integrated'}`, {
          event_category: 'Transaction',
        });

        setSignFinishedData({
          data: sig,
          approvalId: approval.id,
        });
      } else {
        setConnectStatus(WALLETCONNECT_STATUS_MAP.FAILED);
        setErrorMessage(data.errorMsg);
      }
    });

    emitSignComponentAmounted();
  };

  React.useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const account = params.isGnosis
        ? params.account!
        : (await wallet.syncGetCurrentAccount())!;
      if (!mountedRef.current) return;
      setTitle(
        <div className="flex justify-center items-center">
          <img src={brandContent?.icon} className="w-20 mr-8" />
          <span>
            {t('page.signFooterBar.qrcode.signWith', {
              brand: account.brandName,
            })}
          </span>
        </div>
      );
      await init();
    })().catch(console.error);
    return () => {
      mountedRef.current = false;
      subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      subscriptionsRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    setPopupProps(params?.extra?.popupProps);
  }, [params?.extra?.popupProps]);

  React.useEffect(() => {
    if (signFinishedData && isClickDone) {
      closePopup();
      resolveApproval(
        signFinishedData.data,
        false,
        false,
        signFinishedData.approvalId
      );
    }
  }, [signFinishedData, isClickDone]);

  React.useEffect(() => {
    setVisible(true);
    switch (connectStatus) {
      case WALLETCONNECT_STATUS_MAP.WAITING:
        setStatusProp('SENDING');
        setContent(t('page.signFooterBar.ledger.siging'));
        setDescription('');
        break;
      case WALLETCONNECT_STATUS_MAP.SUBMITTING:
        setStatusProp('SENDING');
        setContent(t('page.signFooterBar.ledger.submitting'));
        setDescription('');
        break;
      case WALLETCONNECT_STATUS_MAP.FAILED:
        setStatusProp('REJECTED');
        setContent(t('page.signFooterBar.ledger.txRejected'));
        setDescription(errorMessage);
        break;
      case WALLETCONNECT_STATUS_MAP.SUBMITTED:
        setStatusProp('RESOLVED');
        setContent(t('page.signFooterBar.qrcode.sigCompleted'));
        setDescription('');
        break;
      default:
        break;
    }
  }, [connectStatus, errorMessage]);

  const hdType = React.useMemo(() => {
    switch (brandContent?.brand) {
      case WALLET_BRAND_TYPES.GRIDPLUS:
        return 'wireless';

      default:
        return 'wired';
    }
  }, [brandContent?.brand]);

  if (!brandContent) {
    throw new Error(t('page.signFooterBar.common.notSupport', [brandName]));
  }

  return (
    <ApprovalPopupContainer
      showAnimation
      hdType={hdType}
      status={statusProp}
      onRetry={handleRetry}
      content={content}
      description={description}
      onDone={() => setIsClickDone(true)}
      onCancel={handleCancel}
      hasMoreDescription={!!errorMessage}
    />
  );
};
