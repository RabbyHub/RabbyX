import { DEX_ENUM } from '@rabby-wallet/rabby-swap';
import { CHAINS_ENUM } from '@debank/common';
import { createPersistStore } from 'background/utils';
import { GasCache, ChainGas } from './preference';
import { CEX, DEX } from '@/constant';

type ViewKey = keyof typeof CEX | keyof typeof DEX;

export type SwapServiceStore = {
  gasPriceCache: GasCache;
  selectedDex: DEX_ENUM | null;
  selectedChain: CHAINS_ENUM;
  unlimitedAllowance: boolean;
  viewList: Record<ViewKey, boolean>;
  tradeList: Record<ViewKey, boolean>;
};

class SwapService {
  store: SwapServiceStore = {
    gasPriceCache: {},
    selectedChain: CHAINS_ENUM.ETH,
    selectedDex: null,
    unlimitedAllowance: false,
    viewList: {} as SwapServiceStore['viewList'],
    tradeList: {} as SwapServiceStore['tradeList'],
  };

  init = async () => {
    const storage = await createPersistStore<SwapServiceStore>({
      name: 'swap',
      template: {
        gasPriceCache: {},
        selectedChain: CHAINS_ENUM.ETH,
        selectedDex: null,
        unlimitedAllowance: false,
        viewList: {} as SwapServiceStore['viewList'],
        tradeList: {} as SwapServiceStore['tradeList'],
      },
    });
    if (storage) {
      const values = Object.values(DEX_ENUM);
      if (storage.selectedDex && !values.includes(storage.selectedDex)) {
        storage.selectedDex = null;
      }
    }
    this.store = storage || this.store;
  };

  getSwap = (key?: keyof SwapServiceStore) => {
    return key ? this.store[key] : this.store;
  };

  getLastTimeGasSelection = (chainId: keyof GasCache): ChainGas | null => {
    const cache = this.store.gasPriceCache[chainId];
    if (cache && cache.lastTimeSelect === 'gasPrice') {
      if (Date.now() <= (cache.expireAt || 0)) {
        return cache;
      } else if (cache.gasLevel) {
        return {
          lastTimeSelect: 'gasLevel',
          gasLevel: cache.gasLevel,
        };
      } else {
        return null;
      }
    } else {
      return cache;
    }
  };

  updateLastTimeGasSelection = (chainId: keyof GasCache, gas: ChainGas) => {
    if (gas.lastTimeSelect === 'gasPrice') {
      this.store.gasPriceCache = {
        ...this.store.gasPriceCache,
        [chainId]: {
          ...this.store.gasPriceCache[chainId],
          ...gas,
          expireAt: Date.now() + 3600000, // custom gasPrice will expire at 1h later
        },
      };
    } else {
      this.store.gasPriceCache = {
        ...this.store.gasPriceCache,
        [chainId]: {
          ...this.store.gasPriceCache[chainId],
          ...gas,
        },
      };
    }
  };

  getSelectedDex = () => {
    return this.store.selectedDex;
  };

  setSelectedDex = (dexId: DEX_ENUM) => {
    this.store.selectedDex = dexId;
  };

  getSelectedChain = () => {
    return this.store.selectedChain;
  };

  setSelectedChain = (chain: CHAINS_ENUM) => {
    this.store.selectedChain = chain;
  };

  getUnlimitedAllowance = () => {
    return this.store.unlimitedAllowance;
  };

  setUnlimitedAllowance = (bool: boolean) => {
    this.store.unlimitedAllowance = bool;
  };

  getSwapViewList = () => {
    return this.store.viewList;
  };

  setSwapView = (id: ViewKey, bool: boolean) => {
    if (!this.store.viewList) {
      this.store.viewList = {} as SwapServiceStore['viewList'];
    }
    this.store.viewList = {
      ...this.store.viewList,
      [id]: bool,
    };
  };

  getSwapTradeList = () => {
    return this.store.tradeList;
  };

  setSwapTrade = (dexId: ViewKey, bool: boolean) => {
    if (!this.store.tradeList) {
      this.store.tradeList = {} as SwapServiceStore['tradeList'];
    }
    this.store.tradeList = {
      ...this.store.tradeList,
      [dexId]: bool,
    };
  };
}

export default new SwapService();
