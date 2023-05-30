import React, { useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Chain } from 'background/service/openapi';
import { Result } from '@debank/rabby-security-engine';
import { ParsedActionData, RevokeNFTRequireData } from './utils';
import { formatAmount, formatUsdValue } from 'ui/utils/number';
import { getTimeSpan } from 'ui/utils/time';
import { isSameAddress } from '@/ui/utils';
import { useRabbyDispatch, useRabbySelector } from '@/ui/store';
import { Table, Col, Row } from './components/Table';
import AddressMemo from './components/AddressMemo';
import NFTWithName from './components/NFTWithName';
import * as Values from './components/Values';

const Wrapper = styled.div`
  .header {
    margin-top: 15px;
  }
  .icon-edit-alias {
    width: 13px;
    height: 13px;
    cursor: pointer;
  }
  .icon-scam-token {
    margin-left: 4px;
    width: 13px;
  }
  .icon-fake-token {
    margin-left: 4px;
    width: 13px;
  }
  li .name-and-address {
    justify-content: flex-start;
    .address {
      font-weight: 400;
      font-size: 12px;
      line-height: 14px;
      color: #999999;
    }
    img {
      width: 12px !important;
      height: 12px !important;
      margin-left: 4px !important;
    }
  }
`;

const RevokeNFT = ({
  data,
  requireData,
  chain,
}: {
  data: ParsedActionData['revokeNFT'];
  requireData: RevokeNFTRequireData;
  chain: Chain;
  engineResults: Result[];
}) => {
  const actionData = data!;
  const dispatch = useRabbyDispatch();
  const { userData } = useRabbySelector((s) => ({
    userData: s.securityEngine.userData,
    rules: s.securityEngine.rules,
    processedRules: s.securityEngine.currentTx.processedRules,
  }));

  const spenderInWhitelist = useMemo(() => {
    return !!userData.contractWhitelist.find((contract) => {
      return (
        isSameAddress(contract.address, actionData.spender) &&
        contract.chainId === chain.serverId
      );
    });
  }, [userData, requireData, chain]);
  const spenderInBlacklist = useMemo(() => {
    return !!userData.contractBlacklist.find((contract) => {
      return isSameAddress(contract.address, actionData.spender);
    });
  }, [userData, requireData, chain]);

  const timeSpan = useMemo(() => {
    const bornAt = requireData.bornAt;

    const { d, h, m } = getTimeSpan(Math.floor(Date.now() / 1000) - bornAt);
    if (d > 0) {
      return `${d} Day${d > 1 ? 's' : ''} ago`;
    }
    if (h > 0) {
      return `${h} Hour${h > 1 ? 's' : ''} ago`;
    }
    if (m > 1) {
      return `${m} Minutes ago`;
    }
    return '1 Minute ago';
  }, [requireData]);

  useEffect(() => {
    dispatch.securityEngine.init();
  }, []);

  return (
    <Wrapper>
      <Table>
        <Col>
          <Row isTitle>Revoke NFT</Row>
          <Row>
            <NFTWithName nft={actionData?.nft}></NFTWithName>
            <ul className="desc-list">
              {actionData?.nft?.collection && (
                <li>
                  <div className="whitespace-nowrap overflow-hidden overflow-ellipsis">
                    {actionData?.nft?.collection?.name}
                  </div>
                </li>
              )}
              <li>
                Floor price{' '}
                {actionData?.nft?.collection?.floor_price ? (
                  <>
                    {formatAmount(actionData?.nft?.collection?.floor_price)}
                    ETH
                  </>
                ) : (
                  '-'
                )}
              </li>
              <li>
                <Values.Address
                  address={actionData.nft.contract_id}
                  chain={chain}
                />
              </li>
            </ul>
          </Row>
        </Col>
      </Table>
      <div className="header">
        <div className="left">
          <Values.Address
            address={actionData.spender}
            chain={chain}
            iconWidth="16px"
          />
        </div>
        <div className="right">revoke from</div>
      </div>
      <Table>
        <Col>
          <Row isTitle>Protocol</Row>
          <Row>
            <Values.Protocol value={requireData.protocol} />
          </Row>
        </Col>
        <Col>
          <Row isTitle>Type</Row>
          <Row>{requireData.isEOA ? 'EOA' : 'Contract'}</Row>
        </Col>
        <Col>
          <Row isTitle>{requireData.isEOA ? 'First on-chain' : 'Deployed'}</Row>
          <Row>{timeSpan}</Row>
        </Col>
        {requireData.riskExposure !== null && (
          <Col>
            <Row
              isTitle
              tip="The USD value of the top NFT that has approved to this spender address"
            >
              Risk exposure
            </Row>
            <Row>
              <Values.Text>
                {formatUsdValue(requireData.riskExposure)}
              </Values.Text>
            </Row>
          </Col>
        )}
        <Col>
          <Row isTitle>Popularity</Row>
          <Row>
            {requireData.rank ? `No.${requireData.rank} on ${chain.name}` : '-'}
          </Row>
        </Col>
        <Col>
          <Row isTitle>Interacted before</Row>
          <Row>
            <Values.Boolean value={requireData.hasInteraction} />
          </Row>
        </Col>
        <Col>
          <Row isTitle>Address note</Row>
          <Row>
            <AddressMemo address={actionData.spender} />
          </Row>
        </Col>
        <Col>
          <Row isTitle>My mark</Row>
          <Row>
            <Values.AddressMark
              address={actionData.spender}
              chain={chain}
              onWhitelist={spenderInWhitelist}
              onBlacklist={spenderInBlacklist}
              onChange={() => dispatch.securityEngine.init()}
              isContract
            />
          </Row>
        </Col>
      </Table>
    </Wrapper>
  );
};

export default RevokeNFT;
