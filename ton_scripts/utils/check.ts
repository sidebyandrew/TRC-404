import { getTrc404CollectionAndMasterAddress, getAllCompileCode } from "../contract/compileContract";
import { getWalletContract, user1, user2 } from "../contract/clientAndWallet";
import { WalletContractV4 } from "@ton/ton";
import { OpenedContract, fromNano, toNano, Address, Cell } from "@ton/core";
import { Trc404NftCollection } from "../test/warpper/Trc404NftCollection";
import { Trc404Master, checkMintFtTX } from "../test/warpper/Trc404Master";
import { Trc404Wallet } from "../test/warpper/Trc404Wallet";
import { owned_nft_limit, freemint_max_supply, freemint_price } from "../contract/compileContract";


import {
    Blockchain,
    SandboxContract,
    TreasuryContract,
    printTransactionFees,
    prettyLogTransactions,
    RemoteBlockchainStorage,
    wrapTonClient4ForRemote,
} from "@ton/sandbox";
import { getInitDeployMasterMsg } from "../contract/initDeployContract";



export async function deployAndCheckCollectionAndMasterContract(blockchain: Blockchain, deployer: SandboxContract<TreasuryContract>) {
    //****************1. compile and get contract address
    let compliedCodes = await getAllCompileCode();
    let { deployTrc404CollectionContract, collection_init, deployMasterContractAddress, master_init } =
        await getTrc404CollectionAndMasterAddress(compliedCodes, deployer.address); //deployer as admin of collection and master contract

    let Collection = blockchain.openContract(new Trc404NftCollection(deployTrc404CollectionContract, collection_init));
    let Master = blockchain.openContract(new Trc404Master(deployMasterContractAddress, master_init));

    //2. Send Transaction
    //deploy collection
    const deployCollectionResult = await Collection.send(deployer.getSender(),
        { value: toNano("0.02") }, Cell.EMPTY);
    expect(deployCollectionResult.transactions).toHaveTransaction({
        from: deployer.address,
        to: Collection.address,
        deploy: true,
        success: true,
    });

    //deploy master
    const deployMasterResult = await Master.send(deployer.getSender(),
        { value: toNano("0.02") }, getInitDeployMasterMsg(0));
    expect(deployMasterResult.transactions).toHaveTransaction({
        from: deployer.address,
        to: Master.address,
        deploy: true,
        success: true,
    });

    //3.check init data
    //check Master init data
    let jettonData = await Master.getGetJettonData();
    expect(jettonData.total_supply).toEqual(0n);
    expect(jettonData.mintable).toEqual(true);
    expect(jettonData.owner.equals(deployer.address));
    expect(jettonData.nft_collection_address.equals(Collection.address));
    expect(jettonData.freemint_flag).toEqual(-1);
    expect(jettonData.freemint_max_supply).toBe(toNano("1000")); // 1000 * 10^9
    expect(jettonData.freemint_current_supply).toBe(0n);
    expect(jettonData.freemint_price).toEqual(toNano("1"));

    //check collection init data
    let collectionData = await Collection.getGetCollectionData();
    expect(collectionData.next_item_index).toEqual(0n);
    expect(collectionData.owner_address.equals(deployer.address));

    return { compliedCodes, Collection, Master };

}

export async function checkMintFt(mintAmount: number, gasFee: number, sender: SandboxContract<TreasuryContract>, blockchain: Blockchain,
    Master: SandboxContract<Trc404Master>, Collection: SandboxContract<Trc404NftCollection>,
    userAddress: Address, testNftItemIndex: bigint, msg: Cell) {
    const user_trc404_Wallet = await Master.getGetWalletAddress(userAddress);
    const nft_item_adddress = await Collection.getGetNftAddressByIndex(testNftItemIndex) as Address;

    const totalSupplyBefore = (await Master.getGetJettonData()).total_supply;
    //console.log("totalSupplyBefore:",totalSupplyBefore);
    //mint FT to user1 
    const mintFfResult = await Master.send(sender.getSender(), { value: toNano(gasFee) }, msg);
    //check if there is a action occur error and bounced
    checkMintFtTX(mintFfResult, sender.address, Master.address, user_trc404_Wallet, Collection.address, nft_item_adddress);

    //printTransactionFees(mintFfResult.transactions);

    const totalSupplyAfter = (await Master.getGetJettonData()).total_supply;
    //console.log("totalSupplyAfter:",totalSupplyAfter);
    expect(totalSupplyBefore + toNano(mintAmount)).toEqual(totalSupplyAfter);


    //check user1's trc404 wallet's balance,owned_nft_number and owned_nft_dict
    let Wallet = blockchain.openContract(new Trc404Wallet(user_trc404_Wallet));
    let wallet_DataRes = await Wallet.getWalletData();
    // jetton_balance,owner_address,jetton_master_address,jetton_wallet_code,nft_collection_address,owned_nft_dict,owned_nft_number
    expect(wallet_DataRes.jetton_balance).toEqual(toNano(mintAmount));
    expect(wallet_DataRes.owner_address.equals(userAddress));
    let should_owned_nft_number = toNano(mintAmount) / toNano("1") >= owned_nft_limit ? owned_nft_limit : toNano(mintAmount) / toNano("1");
    expect(wallet_DataRes.owned_nft_number).toEqual(BigInt(should_owned_nft_number));
}