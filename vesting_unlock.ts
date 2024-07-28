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

// new block
// const ref: OutRef = { txHash: Deno.args[0], outputIndex: 1 }
// const [utxo] = await lucid.utxosByOutRef([ref]);
// console.log(`\nDatum of utxo: ${utxo.datum}\n${utxo.txHash}\n`);
// console.log(`\nUTXO: ${utxo}\n`);
// new end

const Datum = Data.Object({
    lock_until: Data.BigInt,
    owner: Data.String,
    beneficiary: Data.String,
});

type Datum = Data.Static<typeof Datum>;

const currentTime = new Date().getTime();

// new block
// let datum = Data.from<Datum>(
//     utxo.datum,
//     Datum,
// );

// if (utxo && datum) {
//     if (datum.beneficiary === beneficiaryPublicHash &&
//             datum.lock_until <= currentTime) {
//         console.log(`\nis datum valid?: ${datum.lock_until}\n`);
//         console.log(`\nthe datum: ${datum}\n`);
//     } else {
//         console.log("No redeemable utxo found. You need to wait a little longer...");
//         Deno.exit(1);
//     }
// }
// new end

const utxos = scriptUtxos.filter((utxo) => {
    try {
        let datum = Data.from<Datum>(
            utxo.datum,
            Datum,
        );
        if (utxo.txHash === Deno.args[0]) {
            console.log(`\nCurrent time: ${currentTime}\n`);
            console.log(`\nDatum lock time: ${datum.lock_until}\n`);
        }
        return (datum.beneficiary === beneficiaryPublicHash &&
            datum.lock_until <= currentTime) && utxo.txHash === Deno.args[0];
    } catch (err) {
        console.log(`EEEEEEERRRRRRRRRRRRRRR!!!: ${err.message}`);
        return false;
    }
});

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
    const laterTime = new Date(currentTime + 4 * 60 * 60 * 1000).getTime();

    const tx = await lucid
        .newTx()
        .collectFrom(utxos, using)
        .addSigner(await lucid.wallet.address())
        .validFrom(currentTime)
        .validTo(laterTime)
        .attachSpendingValidator(from)
        .complete();

    const signedTx = await tx.sign().complete();

    return signedTx.submit();
}