import { Web3ProviderEngine } from '@0x/dev-utils';
import { RPCSubprovider, SupportedProvider } from '@0x/subproviders';
import { providerUtils } from '@0x/utils';
import * as chai from 'chai';
import 'mocha';
import * as request from 'supertest';
import { Connection, Repository } from 'typeorm';

import {
    createMetaTxnServiceFromOrderBookService,
    createSwapServiceFromOrderBookService,
    getAppAsync,
} from '../src/app';
import * as config from '../src/config';
import { META_TRANSACTION_PATH, SRA_PATH } from '../src/constants';
import { getDBConnectionAsync } from '../src/db_connection';
import { TransactionEntity } from '../src/entities';
import { GeneralErrorCodes } from '../src/errors';
import { OrderBookService } from '../src/services/orderbook_service';
import { StakingDataService } from '../src/services/staking_data_service';
import { TransactionWatcherService } from '../src/services/transaction_watcher_service';
import { TransactionStates } from '../src/types';
import { MeshClient } from '../src/utils/mesh_client';
import { utils } from '../src/utils/utils';

import { TestMetaTxnUser } from './utils/test_signer';

const { expect } = chai;
const NUMBER_OF_RETRIES = 20;

let app: Express.Application;
let transactionEntityRepository: Repository<TransactionEntity>;
let txWatcher: TransactionWatcherService;
let connection: Connection;
let metaTxnUser: TestMetaTxnUser;
let provider: SupportedProvider;
// const LOW_GAS_PRICE = 1337;
// const MID_GAS_PRICE = 4000000000;
// const HIGH_GAS_PRICE = 9000000000;
const WAIT_DELAY_IN_MS = 5000;
// const SHORT_EXPECTED_MINE_TIME_SEC = 15;

async function _waitUntilStatusAsync(
    txHash: string,
    status: TransactionStates,
    repository: Repository<TransactionEntity>,
): Promise<void> {
    for (let i = 0; i < NUMBER_OF_RETRIES; i++) {
        const tx = await repository.findOne(txHash);
        if (tx !== undefined && tx.status === status) {
            return;
        }
        await utils.delayAsync(WAIT_DELAY_IN_MS);
    }

    throw new Error(`failed to grab transaction: ${txHash} in a ${status} state`);
}

describe('transaction watcher service', () => {
    before(async () => {
        const providerEngine = new Web3ProviderEngine();
        providerEngine.addProvider(new RPCSubprovider(config.ETHEREUM_RPC_URL));
        providerUtils.startProviderEngine(providerEngine);
        provider = providerEngine;

        connection = await getDBConnectionAsync();

        transactionEntityRepository = connection.getRepository(TransactionEntity);
        txWatcher = new TransactionWatcherService(connection);
        await txWatcher.syncTransactionStatusAsync();
        const orderBookService = new OrderBookService(connection);
        const metaTransactionService = createMetaTxnServiceFromOrderBookService(orderBookService, provider, connection);
        const stakingDataService = new StakingDataService(connection);
        const websocketOpts = { path: SRA_PATH };
        const swapService = createSwapServiceFromOrderBookService(orderBookService, provider);

        const meshClient = new MeshClient(config.MESH_WEBSOCKET_URI, config.MESH_HTTP_URI);
        // const signerService = new SignerService(connection);

        metaTxnUser = new TestMetaTxnUser('https://kovan.api.0x.org', connection);

        app = await getAppAsync(
            {
                orderBookService,
                metaTransactionService,
                stakingDataService,
                connection,
                provider,
                swapService,
                meshClient,
                websocketOpts,
            },
            config,
        );
    });
    it('sends a signed zeroex transaction correctly', async () => {
        const { zeroExTransactionHash, zeroExTransaction } = await metaTxnUser.getQuoteAsync('MKR', 'ETH', '50000000');
        const signature = await metaTxnUser.signAsync(zeroExTransactionHash);
        await request(app)
            .post(`${META_TRANSACTION_PATH}/submit`)
            .set('0x-api-key', 'e20bd887-e195-4580-bca0-322607ec2a49')
            .send({ signature, zeroExTransaction })
            // .expect('Content-Type', /json/)
            .then(response => {
                expect(response.body.code).to.not.equal(GeneralErrorCodes.InvalidAPIKey);
                const data = response.body;
                console.log(data);
            });
        // send tx with 1 gwei gas price
        // const txHash = await signer.prepareAndStoreMetaTx();
        // await waitUntilStatusAsync(txHash, TransactionStates.Confirmed, transactionEntityRepository);
        // const storedTx = await transactionEntityRepository.findOne(txHash);
        // expect(storedTx).to.not.be.undefined();
        // expect(storedTx).to.include({ hash: txHash });
        // expect(storedTx).to.not.include({ blockNumber: null });
    });
    it('does something', async () => {
        await _waitUntilStatusAsync('', TransactionStates.Submitted, transactionEntityRepository);
    });
    // it('unsticks a transaction correctly', async () => {
    //     // send a transaction with a very low gas price
    //     const txHash = await signer.sendTransactionToItselfAsync(
    //         new BigNumber(LOW_GAS_PRICE),
    //         SHORT_EXPECTED_MINE_TIME_SEC,
    //     );
    //     await waitUntilStatusAsync(txHash, TransactionStates.Stuck, transactionEntityRepository);
    //     const storedTx = await transactionEntityRepository.findOne(txHash);
    //     if (storedTx === undefined) {
    //         throw new Error('stored tx is undefined');
    //     }
    //     const unstickTxHash = await signer.sendUnstickingTransactionAsync(
    //         new BigNumber(HIGH_GAS_PRICE),
    //         web3WrapperUtils.encodeAmountAsHexString(storedTx.nonce),
    //     );
    //     await waitUntilStatusAsync(unstickTxHash, TransactionStates.Confirmed, transactionEntityRepository);
    // });
});
