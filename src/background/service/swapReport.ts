import stats from '@/stats';
import { CHAINS_ENUM } from '@debank/common';

interface SwapState {
  dex:string;
  chainId: string;
  addr: string;
  txId: string;
  fromToken: string;
  toToken: string;
  fromTokenAmount: string;
  toTokenAmount: string;
}

class SwapReport {
  reportMap: Map<string, SwapState> = new Map();

  txReport = (chain: CHAINS_ENUM, tx: string, success: boolean) => {
    const key = `${chain}-${tx}`;
    const v = this.reportMap.get(key);
    if (v) {
      if (success) {
        stats.report('swapTxSucceeded', { ...v });
      }
      this.reportMap.delete(key);
    }
  };



  add = (chain: CHAINS_ENUM, tx: string, v: SwapState) => {
    this.reportMap.set(`${chain}-${tx}`, v);
  };


}

export default new SwapReport();
