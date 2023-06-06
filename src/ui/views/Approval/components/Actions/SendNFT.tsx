import React, { useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { Chain } from 'background/service/openapi';
import { Result } from '@debank/rabby-security-engine';
import { ParsedActionData, SendNFTRequireData } from './utils';
import { useRabbyDispatch } from '@/ui/store';
import { Table, Col, Row } from './components/Table';
import LogoWithText from './components/LogoWithText';
import NFTWithName from './components/NFTWithName';
import * as Values from './components/Values';
import ViewMore from './components/ViewMore';
import { SecurityListItem } from './components/SecurityListItem';

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

const SendNFT = ({
  data,
  requireData,
  chain,
  engineResults,
}: {
  data: ParsedActionData['sendNFT'];
  requireData: SendNFTRequireData;
  chain: Chain;
  engineResults: Result[];
}) => {
  const actionData = data!;
  const dispatch = useRabbyDispatch();

  const engineResultMap = useMemo(() => {
    const map: Record<string, Result> = {};
    engineResults.forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }, [engineResults]);

  useEffect(() => {
    dispatch.securityEngine.init();
  }, []);

  return (
    <Wrapper>
      <Table>
        <Col>
          <Row isTitle>Send NFT</Row>
          <Row>
            <NFTWithName nft={actionData?.nft}></NFTWithName>
            <ul className="desc-list">
              {actionData?.nft?.amount > 1 && (
                <li>Amount: {actionData?.nft?.amount}</li>
              )}
              <li>
                <ViewMore
                  type="nft"
                  data={{
                    nft: actionData.nft,
                    chain,
                  }}
                />
              </li>
            </ul>
          </Row>
        </Col>
        <Col>
          <Row isTitle>Send to</Row>
          <Row>
            <div>
              <Values.Address address={actionData.to} chain={chain} />
              <ul className="desc-list">
                <li>
                  <Values.AddressMemo address={actionData.to} />
                </li>
                {requireData.name && <li>{requireData.name}</li>}
                <SecurityListItem
                  engineResult={engineResultMap['1016']}
                  dangerText="Token address"
                  id="1016"
                />
                <SecurityListItem
                  engineResult={engineResultMap['1037']}
                  dangerText="Contract address not on this chain"
                  id="1037"
                />
                {requireData.cex && (
                  <>
                    <li>
                      <LogoWithText
                        logo={requireData.cex.logo}
                        text={requireData.cex.name}
                        logoSize={14}
                        textStyle={{
                          fontSize: '13px',
                          lineHeight: '15px',
                          color: '#999999',
                          fontWeight: 'normal',
                        }}
                      />
                    </li>
                    <SecurityListItem
                      engineResult={engineResultMap['1039']}
                      dangerText="Not top up address"
                      id="1039"
                    />
                    <SecurityListItem
                      engineResult={engineResultMap['1038']}
                      dangerText={'token not supported'}
                      id="1038"
                    />
                  </>
                )}
                <SecurityListItem
                  engineResult={engineResultMap['1036']}
                  warningText="Never transacted before"
                  id="1036"
                />
                <SecurityListItem
                  engineResult={engineResultMap['1042']}
                  safeText="On my send whitelist"
                  id="1042"
                />
                <li>
                  <ViewMore
                    type="receiver"
                    data={{
                      address: actionData.to,
                      chain,
                      eoa: requireData.eoa,
                      cex: requireData.cex,
                      contract: requireData.contract,
                      usd_value: requireData.usd_value,
                      hasTransfer: requireData.hasTransfer,
                      isTokenContract: requireData.isTokenContract,
                      name: requireData.name,
                      onTransferWhitelist: !!engineResultMap['1042'],
                    }}
                  />
                </li>
              </ul>
            </div>
          </Row>
        </Col>
      </Table>
    </Wrapper>
  );
};

export default SendNFT;
