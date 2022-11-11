import React from 'react';
import { useEffect, useState } from 'react';
import { Redirect, useHistory } from 'react-router-dom';
import { getUiType, useApproval, useWallet } from 'ui/utils';
import { Spin } from 'ui/component';
import { Approval } from 'background/service/notification';

/**
 * @description used as router's Root Component in fact.
 */
const SortHat = () => {
  const wallet = useWallet();
  const [to, setTo] = useState('');
  // eslint-disable-next-line prefer-const
  let [getApproval] = useApproval();

  const UIType = getUiType();
  const history = useHistory();

  const loadView = async () => {
    const approval: Approval | undefined = await getApproval();
    if ((UIType.isNotification) && !approval) {
      // redirect back to dashboard on no approval
      history.replace('/dashboard');

      return;
    }

    if (!(await wallet.isBooted())) {
      history.replace('/welcome');
      return;
    }

    if (!(await wallet.isUnlocked())) {
      history.replace('/unlock');
      return;
    }

    if (
      (await wallet.hasPageStateCache()) &&
      !UIType.isNotification &&
      !UIType.isTab &&
      !approval
    ) {
      const cache = (await wallet.getPageStateCache())!;
      history.replace(cache.path + (cache.search || ''));
      return;
    }

    if ((await wallet.getPreMnemonics()) && !UIType.isNotification && !UIType.isTab) {
      history.replace('/create-mnemonics');
      return;
    }

    const currentAccount = await wallet.getCurrentAccount();

    if (!currentAccount) {
      history.replace('/no-address');
    } else if (approval && UIType.isNotification) {
      history.replace('/approval');
    } else {
      history.replace('/dashboard');
    }
  };

  useEffect(() => {
    loadView();
    return () => {
      setTimeout(() => {
        const skeleton = document.querySelector('#skeleton');
        if (skeleton) {
          document.head.removeChild(skeleton);
        }
      }, 16);
    };
  }, []);

  return (
    <div className="h-full flex items-center justify-center">
      {(UIType.isPop) ? (
        <>{to && <Redirect to={to} />}</>
      ) : (
        <Spin spinning={!to}>{to && <Redirect to={to} />}</Spin>
      )}
    </div>
  );
};

export default SortHat;
