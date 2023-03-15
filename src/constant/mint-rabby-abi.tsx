// TODO: temporary for testing, will be replaced with production contract address
export const MintRabbyContractAddress =
  '0xe473A20617f20f4A7B4fBDD39490380B78430141';

export const MintRabbyAbi = [
  {
    inputs: [{ internalType: 'address', name: 'minter', type: 'address' }],
    name: 'mintedPerAddress',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'totalMints', type: 'uint256' },
          { internalType: 'uint256', name: 'presaleMints', type: 'uint256' },
          { internalType: 'uint256', name: 'publicMints', type: 'uint256' },
        ],
        internalType: 'struct IERC721Drop.AddressMintDetails',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'quantity', type: 'uint256' }],
    name: 'purchase',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },

  {
    inputs: [{ internalType: 'uint256', name: 'quantity', type: 'uint256' }],
    name: 'zoraFeeForAmount',
    outputs: [
      { internalType: 'address payable', name: 'recipient', type: 'address' },
      { internalType: 'uint256', name: 'fee', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];
