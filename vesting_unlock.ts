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

lucid.selectWalletFromPrivateKey(await Deno.readTextFile("./beneficiary.sk"));

const beneficiaryPublicHash = lucid.utils.getAddressDetails(
    await lucid.wallet.address()
).paymentCredential.hash;

// Read the validator from the plutus file and convert to a readable format by the blockchain
const validator = await readValidator();

async function readValidator(): Promise<SpendingValidator> {
    const validator = JSON.parse(await Deno.readTextFile("plutus.json")).validators[0];
    return {
        type: "PlutusV2",
        script: toHex(cbor.encode(fromHex(validator.compiledCode))),
    };
}


// Unlocking vesting...

const scriptAddress = lucid.utils.validatorToAddress(validator);

const scriptUtxos = await lucid.utxosAt(scriptAddress); 

const Datum = Data.Object({
    lock_until: Data.BigInt,
    owner: Data.String,
    beneficiary: Data.String,
});

type Datum = Data.Static<typeof Datum>;

const currentTime = new Date().getTime();

const utxos = scriptUtxos.filter((utxo) => {
    try {
        let datum = Data.from<Datum>(
            utxo.datum,
            Datum,
        );

        return datum.beneficiary === beneficiaryPublicHash &&
            datum.lock_until <= currentTime;
    } catch (err) {
        console.log(`EEEEEEERRRRRRRRRRRRRRR!!!: ${err.message}`);
        return false;
    }
});

// log code
for (let i in utxos) {
    console.log(`\nUTXO Array element: ${utxos[i].datum}\n${utxos[i].txHash}`);
}

if (utxos.length === 0) {
    console.log("No redeemable utxo found. You need to wait a little longer...");
    Deno.exit(1);
}

const redeemer = Data.empty();

const txUnlock = await unlock(utxos, currentTime, { from: validator, using: redeemer });

await lucid.awaitTx(txUnlock);

console.log(`1 tADA recovered from the contract
    Tx ID: ${txUnlock}
    Redeemer: ${redeemer}
`);

async function unlock(utxos, currentTime, { from, using }): Promise<TxHash> {
    let lower = (Date.now() - 100000);
    let upper = (Date.now() + 500000);

    lower = lower - lower % 1000;
    upper = upper - upper % 1000;

    console.log(`Upper - Lower: ${upper - lower}`);

    const tx = await lucid
        .newTx()
        .collectFrom(utxos, using)
        .addSigner(await lucid.wallet.address())
        .validFrom(lower)
        .validTo(upper)
        .attachSpendingValidator(from)
        .complete();

    const signedTx = await tx.sign().complete();

    return signedTx.submit();
}