import { ExplainTxResponse } from '@debank/rabby-api/dist/types';
import { getMintRabbyContractAddress } from './mint-rabby-abi';
import IconRabbySVG from 'src/ui/assets/dashboard/rabby.svg';
import { isSameAddress } from '@/ui/utils';

export const genMintRabbyTxDetail = (
  txDetail: ExplainTxResponse
): ExplainTxResponse => {
  if (!txDetail.type_call) {
    return txDetail;
  }

  const { contract } = txDetail.type_call;
  if (!isSameAddress(contract, getMintRabbyContractAddress())) {
    return txDetail;
  }
  return {
    ...txDetail,
    type_call: {
      ...txDetail.type_call,
      contract_protocol_name: 'Rabby Desktop',
      contract_protocol_logo_url: IconRabbySVG,
    },
  };
};
