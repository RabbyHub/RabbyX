import React, { useEffect } from 'react';
import { Switch, Route, Redirect, useHistory } from 'react-router-dom';
import ReactGA, { ga } from 'react-ga';
import { PrivateRoute } from 'ui/component';

import Welcome from 'ui/views/Welcome';
import NoAddress from 'ui/views/NoAddress';
import CreatePassword from 'ui/views/CreatePassword';
import ImportMode from 'ui/views/ImportMode';
import ImportPrivateKey from 'ui/views/ImportPrivateKey';
import ImportJson from 'ui/views/ImportJson';

import InputMnemonics from 'ui/views/ImportMnemonics/InputMnemonics';
import EntryImportAddress from 'ui/views/ImportMnemonics/EntryImportAddress';
import ConfirmMnemonics from 'ui/views/ImportMnemonics/ConfirmMnemonics';

import ImportWatchAddress from 'ui/views/ImportWatchAddress';
import ImportQRCodeBase from 'ui/views/ImportQRCodeBase';
import SelectAddress from 'ui/views/SelectAddress';
import ImportMoreAddress from 'ui/views/ImportMoreAddress';
import ImportSuccess from 'ui/views/ImportSuccess';
import ImportHardware from 'ui/views/ImportHardware';
import ImportLedgerPathSelect from 'ui/views/ImportHardware/LedgerHdPath';
import ImportGnosis from 'ui/views/ImportGnosisAddress';
import ConnectLedger from 'ui/views/ImportHardware/LedgerConnect';
import Settings from 'ui/views/Settings';
import ConnectedSites from 'ui/views/ConnectedSites';
import Approval from 'ui/views/Approval';
import TokenApproval from 'ui/views/TokenApproval';
import NFTApproval from 'ui/views/NFTApproval';
import CreateMnemonics from 'ui/views/CreateMnemonics';
import AddAddress from 'ui/views/AddAddress';
import ChainManagement, { StartChainManagement } from 'ui/views/ChainManagement';
import ChainList from 'ui/views/ChainList';
import AddressManagement from 'ui/views/AddressManagement';
import SwitchLang from 'ui/views/SwitchLang';
import Activities from 'ui/views/Activities';
// import History from 'ui/views/History';
// import GnosisTransactionQueue from 'ui/views/GnosisTransactionQueue';
// import QRCodeReader from 'ui/views/QRCodeReader';
import AdvancedSettings from 'ui/views/AdvanceSettings';
// import RequestPermission from 'ui/views/RequestPermission';
// import SendToken from 'ui/views/SendToken';
// import SendNFT from 'ui/views/SendNFT';
// import Receive from 'ui/views/Receive/index';
import WalletConnectTemplate from 'ui/views/WalletConnect';
import AddressDetail from 'ui/views/AddressDetail';
import AddressBackupMnemonics from 'ui/views/AddressBackup/Mnemonics';
import AddressBackupPrivateKey from 'ui/views/AddressBackup/PrivateKey';
// import Swap from 'ui/views/Swap';
import { getUiType, useApproval, useWallet } from '../utils';
import { browser, Runtime } from 'webextension-polyfill-ts';
// import SwapQuotes from 'ui/views/SwapQuote';
// import GasTopUp from 'ui/views/GasTopUp';
// import ApprovalManage from 'ui/views/ApprovalManage';
// import { ImportMyMetaMaskAccount } from 'ui/views/ImportMyMetaMaskAccount';

ReactGA.initialize('UA-199755108-1');
// eslint-disable-next-line @typescript-eslint/no-empty-function
ga('set', 'checkProtocolTask', function () {});
ga('set', 'appName', 'Rabby');
ga('set', 'appVersion', process.env.release);
ga('require', 'displayfeatures');

declare global {
  interface Window {
    _paq: any;
  }
}

const LogPageView = () => {
  ReactGA.pageview(window.location.hash);
  if (window._paq) {
    window._paq.push(['setCustomUrl', window.location.hash.replace(/#/, '')]);
    window._paq.push(['trackPageView']);
  }

  return null;
};

const Main = () => {
  const wallet = useWallet();

  useEffect(() => {
    (async () => {
      const UIType = getUiType();
      if (UIType.isNotification || UIType.isPop) {
        const hasOtherProvider = await wallet.getHasOtherProvider();
        ReactGA.event({
          category: 'User',
          action: 'active',
          label: UIType.isPop
            ? `popup|${hasOtherProvider ? 'hasMetaMask' : 'noMetaMask'}`
            : `request|${hasOtherProvider ? 'hasMetaMask' : 'noMetaMask'}`,
        });
      }
    })();
  }, []);
  
  // const history = useHistory();
  // const [getApproval] = useApproval();
  // useEffect(() => {
  //   const listener = async (message: any, sender: Runtime.MessageSender) => {
  //     const approval = await getApproval();
  //     if (message.type !== 'rabbyx-openNotification') return ;

  //     if (approval) {
  //       history.push('/approval');
  //     }
  //   };
  //   browser.runtime.onMessage.addListener(listener);

  //   return () => {
  //     browser.runtime.onMessage.removeListener(listener);
  //   }
  // }, [ getApproval, history ]);

  return (
    <>
      <Route path="/" component={LogPageView} />
      <Switch>
        <Route exact path="/welcome">
          <Welcome />
        </Route>
        <Route exact path="/password">
          <CreatePassword />
        </Route>

        <Route exact path="/no-address">
          <NoAddress />
        </Route>
        <PrivateRoute exact path="/start-chain-management">
          <StartChainManagement />
        </PrivateRoute>
        <PrivateRoute exact path="/mnemonics/risk-check">
          <CreateMnemonics />
        </PrivateRoute>
        <Redirect exact path="/create-mnemonics" to="/mnemonics/create" />
        <PrivateRoute exact path="/mnemonics/create">
          <CreateMnemonics />
        </PrivateRoute>
        <PrivateRoute exact path="/import">
          <ImportMode />
        </PrivateRoute>
        <PrivateRoute exact path="/import/entry-import-address">
          <EntryImportAddress />
        </PrivateRoute>
        <PrivateRoute exact path="/import/key">
          <ImportPrivateKey />
        </PrivateRoute>
        <PrivateRoute exact path="/import/json">
          <ImportJson />
        </PrivateRoute>
        <PrivateRoute exact path="/import/mnemonics">
          <InputMnemonics />
        </PrivateRoute>
        <PrivateRoute exact path="/popup/import/mnemonics-confirm">
          <ConfirmMnemonics isPopup />
        </PrivateRoute>
        <PrivateRoute exact path="/import/mnemonics-confirm">
          <ConfirmMnemonics />
        </PrivateRoute>
        <PrivateRoute exact path="/popup/import/mnemonics-import-more-address">
          <ImportMoreAddress isPopup />
        </PrivateRoute>
        <PrivateRoute exact path="/import/mnemonics-import-more-address">
          <ImportMoreAddress />
        </PrivateRoute>
        <PrivateRoute exact path="/popup/import/select-address">
          <SelectAddress isPopup />
        </PrivateRoute>
        <PrivateRoute exact path="/import/select-address">
          <SelectAddress />
        </PrivateRoute>
        <PrivateRoute exact path="/import/hardware">
          <ImportHardware />
        </PrivateRoute>
        <PrivateRoute exact path="/import/hardware/ledger-connect">
          <ConnectLedger />
        </PrivateRoute>
        <PrivateRoute exact path="/import/hardware/ledger">
          <ImportLedgerPathSelect />
        </PrivateRoute>
        <PrivateRoute exact path="/import/watch-address">
          <ImportWatchAddress />
        </PrivateRoute>
        <PrivateRoute exact path="/import/qrcode">
          <ImportQRCodeBase />
        </PrivateRoute>
        <PrivateRoute exact path="/import/wallet-connect">
          <WalletConnectTemplate />
        </PrivateRoute>
        <PrivateRoute exact path="/popup/import/success">
          <ImportSuccess isPopup />
        </PrivateRoute>
        <PrivateRoute exact path="/import/success">
          <ImportSuccess />
        </PrivateRoute>
        {/* <PrivateRoute exact path="/history">
          <History />
        </PrivateRoute> */}
        <PrivateRoute exact path="/activities">
          <Activities />
        </PrivateRoute>
        {/* <PrivateRoute exact path="/gnosis-queue">
          <GnosisTransactionQueue />
        </PrivateRoute>
        <PrivateRoute exact path="/import/gnosis">
          <ImportGnosis />
        </PrivateRoute> */}
        <PrivateRoute exact path="/add-address">
          <AddAddress />
        </PrivateRoute>
        <PrivateRoute exact path="/approval">
          <Approval />
        </PrivateRoute>
        <PrivateRoute exact path="/token-approval">
          <TokenApproval />
        </PrivateRoute>
        <PrivateRoute exact path="/nft-approval">
          <NFTApproval />
        </PrivateRoute>
        <PrivateRoute exact path="/settings">
          <Settings />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/address">
          <AddressManagement />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/address-detail">
          <AddressDetail />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/address-backup/private-key">
          <AddressBackupPrivateKey />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/address-backup/mneonics">
          <AddressBackupMnemonics />
        </PrivateRoute>
        {/* 
        <PrivateRoute exact path="/settings/sites">
          <ConnectedSites />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/chain">
          <ChainManagement />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/chain-list">
          <ChainList />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/switch-lang">
          <SwitchLang />
        </PrivateRoute>
        <PrivateRoute exact path="/settings/advanced">
          <AdvancedSettings />
        </PrivateRoute>
        <PrivateRoute exact path="/qrcode-reader">
          <QRCodeReader />
        </PrivateRoute>
        <PrivateRoute exact path="/request-permission">
          <RequestPermission />
        </PrivateRoute>
        <PrivateRoute exact path="/send-token">
          <SendToken />
        </PrivateRoute>
        <PrivateRoute exact path="/send-nft">
          <SendNFT />
        </PrivateRoute>
        <PrivateRoute exact path="/receive">
          <Receive />
        </PrivateRoute>
        <PrivateRoute exact path="/swap">
          <Swap />
        </PrivateRoute>
        <PrivateRoute exact path="/swap-quotes">
          <SwapQuotes />
        </PrivateRoute>

        <PrivateRoute exact path="/gas-top-up">
          <GasTopUp />
        </PrivateRoute> */}
        {/* <PrivateRoute exact path="/approval-manage">
          <ApprovalManage />
        </PrivateRoute>

        <PrivateRoute exact path="/import/metamask">
          <ImportMyMetaMaskAccount />
        </PrivateRoute> */}
        
        <PrivateRoute exact path="/switch-address">
          <AddressManagement />
        </PrivateRoute>
      </Switch>
    </>
  );
};

export default Main;
