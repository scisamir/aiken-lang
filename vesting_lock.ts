import {
    Blockfrost,
    C,
    Data,
    Lucid,
    SpendingValidator,
    TxHash,
    fromHex,
    toHex
} from "https://deno.land/x/lucid@0.8.3/mod.ts";
import * as cbor from "https://deno.land/x/cbor@v1.4.1/index.js";

// Create new lucid instance to communicate with the cardano blockchain
const lucid = await Lucid.new(
    new Blockfrost(
        "https://cardano-preview.blockfrost.io/api/v0",
        Deno.env.get("BLOCKFROST_API_KEY"),
    ),
    "Preview",
);

lucid.selectWalletFromPrivateKey(await Deno.readTextFile("./owner.sk"));

// Read the validator from the plutus file and convert to a readable format by the blockchain
const validator = await readValidator();

async function readValidator(): Promise<SpendingValidator> {
    const validator = JSON.parse(await Deno.readTextFile("plutus.json")).validators[0];
    return {
        type: "PlutusV2",
        script: toHex(cbor.encode(fromHex(validator.compiledCode))),
    };
}

// Lock funds...

const ownerPublicHash = lucid.utils.getAddressDetails(
    await lucid.wallet.address()
).paymentCredential.hash;

const beneficiaryPublicHash = lucid.utils.getAddressDetails(
    await Deno.readTextFile("beneficiary.addr")
).paymentCredential.hash;

const Datum = Data.Object({
    lock_until: Data.BigInt,
    owner: Data.String,
    beneficiary: Data.String,
});

type Datum = Data.Static<typeof Datum>;

const datum = Data.to<Datum>(
    {
        lock_until: 1672843961000n,
        owner: ownerPublicHash,
        beneficiary: beneficiaryPublicHash,
    },
    Datum
);

const txLock = await lock(1000000, { into: validator, datum: datum });

await lucid.awaitTx(txLock);

console.log(`1 tADA locked into the contract
    Tx ID: ${txLock}
    Datum: ${datum}
`);

async function lock(lovelace, { into, datum }): Promise<TxHash> {
    const contractAddress = lucid.utils.validatorToAddress(into);

    const tx = await lucid
        .newTx()
        .payToContract(contractAddress, { inline: datum }, { lovelace })
        .complete();

    const signedTx = await tx.sign().complete();

    return signedTx.submit();
}