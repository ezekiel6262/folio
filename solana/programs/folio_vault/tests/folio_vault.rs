//! Folio vault, exercised against the real thing.
//!
//! The mints are the actual AAPLx, NVDAx and TSLAx accounts cloned from mainnet, with
//! every issuer extension intact (permanent delegate, pausable, scaled UI amount, an
//! inactive transfer hook). The token program is mainnet's own Token-2022 binary, not a
//! bundled copy. The only change is the mint authority, patched to a test key so the
//! tests can mint shares. Run `node solana/scripts/fetch-fixtures.mjs` first.

use anchor_lang::prelude::{pubkey, Clock, Pubkey};
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use folio_vault::{accounts as acc, instruction as ix, Folio, ADMIN};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");

const AAPLX: Pubkey = pubkey!("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const NVDAX: Pubkey = pubkey!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
const TSLAX: Pubkey = pubkey!("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");

/// xStocks use 8 decimals.
const SHARE: u64 = 100_000_000;
/// Per-folio cap in these tests: half a share of each name.
const CAP: u64 = SHARE / 2;
const DAY: i64 = 86_400;
const NO_KEY: Pubkey = Pubkey::new_from_array([0u8; 32]);
const POLICY: [u8; 32] = [7u8; 32];

// ------------------------------------------------------------------ harness

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    /// Plays the app's sponsoring fee payer: pays every fee and account deposit.
    fee: Keypair,
    alice: Keypair,
    bob: Keypair,
    carol: Keypair,
    mint_authority: Keypair,
}

fn fixture(name: &str) -> Vec<u8> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}: run solana/scripts/fetch-fixtures.mjs"))
}

fn program_so() -> Vec<u8> {
    let path = std::env::var("FOLIO_SO").unwrap_or_else(|_| {
        format!("{}/../../target/deploy/folio_vault.so", env!("CARGO_MANIFEST_DIR"))
    });
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}: run cargo build-sbf first"))
}

fn admin_keypair() -> Keypair {
    let path = format!("{}/../../.keys/deployer.json", env!("CARGO_MANIFEST_DIR"));
    let bytes: Vec<u8> = serde_json_bytes(&std::fs::read_to_string(&path).expect("deployer key"));
    let kp = Keypair::try_from(bytes.as_slice()).expect("valid deployer key");
    assert_eq!(kp.pubkey(), ADMIN, "tests must sign as the hard-coded admin");
    kp
}

/// A solana-keygen file is a JSON array of 64 numbers; parse it without a JSON crate.
fn serde_json_bytes(s: &str) -> Vec<u8> {
    s.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|n| n.trim().parse::<u8>().expect("byte"))
        .collect()
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<(), String> {
    let mut all: Vec<&Keypair> = vec![payer];
    for s in signers {
        if s.pubkey() != payer.pubkey() {
            all.push(s);
        }
    }
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &all, svm.latest_blockhash());
    let result = svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    result
}

fn expect_err(result: Result<(), String>, code: &str) {
    match result {
        Ok(()) => panic!("expected {code}, but the transaction succeeded"),
        Err(logs) => assert!(logs.contains(code), "expected {code}, got:\n{logs}"),
    }
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

fn warp(svm: &mut LiteSVM, seconds: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    svm.set_sysvar::<Clock>(&clock);
}

fn lamports(svm: &LiteSVM, key: &Pubkey) -> u64 {
    svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let data = svm.get_account(account).expect("token account").data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn folio(svm: &LiteSVM, key: &Pubkey) -> Folio {
    let data = svm.get_account(key).expect("folio account").data;
    Folio::try_deserialize(&mut data.as_slice()).expect("folio decodes")
}

// ------------------------------------------------------------------ addresses

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &folio_vault::ID).0
}
fn asset_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"asset", mint.as_ref()], &folio_vault::ID).0
}
fn folio_pda(creator: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"folio", creator.as_ref(), &nonce.to_le_bytes()], &folio_vault::ID).0
}
fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_2022.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}

// ------------------------------------------------------------ instructions

fn program_ix(accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
    Instruction { program_id: folio_vault::ID, accounts, data }
}

fn ix_initialize(admin: &Pubkey) -> Instruction {
    program_ix(
        acc::Initialize { config: config_pda(), admin: *admin, system_program: SYSTEM }.to_account_metas(None),
        ix::Initialize {}.data(),
    )
}

fn ix_set_asset(admin: &Pubkey, mint: &Pubkey, allowed: bool, cap: u64) -> Instruction {
    program_ix(
        acc::SetAsset { config: config_pda(), asset: asset_pda(mint), mint: *mint, admin: *admin, system_program: SYSTEM }
            .to_account_metas(None),
        ix::SetAsset { allowed, cap }.data(),
    )
}

fn ix_set_paused(admin: &Pubkey, paused: bool) -> Instruction {
    program_ix(acc::AdminOnly { config: config_pda(), admin: *admin }.to_account_metas(None), ix::SetPaused { paused }.data())
}

#[allow(clippy::too_many_arguments)]
fn ix_create(
    creator: &Pubkey,
    payer: &Pubkey,
    nonce: u64,
    name: &str,
    unlock_at: i64,
    reclaim_after: i64,
    claim_key: Pubkey,
    recipient: Option<Pubkey>,
) -> Instruction {
    program_ix(
        acc::CreateFolio {
            config: config_pda(),
            folio: folio_pda(creator, nonce),
            creator: *creator,
            payer: *payer,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        ix::CreateFolio {
            nonce,
            name: name.to_string(),
            unlock_at,
            reclaim_after,
            claim_key,
            policy_hash: POLICY,
            recipient,
        }
        .data(),
    )
}

fn ix_deposit(folio: &Pubkey, mint: &Pubkey, depositor: &Pubkey, payer: &Pubkey, amount: u64) -> Instruction {
    program_ix(
        acc::Deposit {
            config: config_pda(),
            folio: *folio,
            asset: asset_pda(mint),
            mint: *mint,
            depositor_token: ata(depositor, mint),
            vault: ata(folio, mint),
            depositor: *depositor,
            payer: *payer,
            token_program: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        }
        .to_account_metas(None),
        ix::Deposit { amount }.data(),
    )
}

fn ix_sync(folio: &Pubkey, mint: &Pubkey) -> Instruction {
    program_ix(
        acc::SyncVault {
            config: config_pda(),
            folio: *folio,
            asset: asset_pda(mint),
            mint: *mint,
            vault: ata(folio, mint),
            token_program: TOKEN_2022,
        }
        .to_account_metas(None),
        ix::SyncVault {}.data(),
    )
}

fn ix_claim(folio: &Pubkey, claim_key: &Pubkey, claimant: &Pubkey) -> Instruction {
    program_ix(
        acc::Claim { folio: *folio, claim_key: *claim_key, claimant: *claimant }.to_account_metas(None),
        ix::Claim {}.data(),
    )
}

fn ix_reclaim(folio: &Pubkey, creator: &Pubkey) -> Instruction {
    program_ix(acc::Reclaim { folio: *folio, creator: *creator }.to_account_metas(None), ix::Reclaim {}.data())
}

fn ix_transfer(folio: &Pubkey, owner: &Pubkey, new_owner: Pubkey) -> Instruction {
    program_ix(
        acc::OwnerOnly { folio: *folio, owner: *owner }.to_account_metas(None),
        ix::TransferFolio { new_owner }.data(),
    )
}

fn ix_extend(folio: &Pubkey, owner: &Pubkey, new_unlock_at: i64) -> Instruction {
    program_ix(
        acc::OwnerOnly { folio: *folio, owner: *owner }.to_account_metas(None),
        ix::ExtendLock { new_unlock_at }.data(),
    )
}

fn ix_withdraw(folio: &Pubkey, mint: &Pubkey, owner: &Pubkey, destination: &Pubkey, amount: u64) -> Instruction {
    program_ix(
        acc::Withdraw {
            folio: *folio,
            mint: *mint,
            vault: ata(folio, mint),
            destination: *destination,
            owner: *owner,
            token_program: TOKEN_2022,
        }
        .to_account_metas(None),
        ix::Withdraw { amount }.data(),
    )
}

fn ix_close_vault(folio: &Pubkey, mint: &Pubkey, owner: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    program_ix(
        acc::CloseVault {
            folio: *folio,
            mint: *mint,
            vault: ata(folio, mint),
            rent_payer: *rent_payer,
            owner: *owner,
            token_program: TOKEN_2022,
        }
        .to_account_metas(None),
        ix::CloseVault {}.data(),
    )
}

fn ix_close_folio(folio: &Pubkey, owner: &Pubkey, rent_payer: &Pubkey) -> Instruction {
    program_ix(
        acc::CloseFolio { folio: *folio, rent_payer: *rent_payer, owner: *owner }.to_account_metas(None),
        ix::CloseFolio {}.data(),
    )
}

// ------------------------------------------------------------- token setup

fn load_mint(svm: &mut LiteSVM, address: Pubkey, file: &str, authority: &Pubkey) {
    let mut data = fixture(file);
    // COption<Pubkey> mint_authority at offset 0: tag (u32 LE, 1 = Some) then the key.
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..36].copy_from_slice(authority.as_ref());
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(address, Account { lamports, data, owner: TOKEN_2022, executable: false, rent_epoch: 0 })
        .expect("mint account");
}

fn create_ata(svm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let address = ata(owner, mint);
    let ix = Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(address, false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(TOKEN_2022, false),
        ],
        data: vec![1], // CreateIdempotent
    };
    send(svm, &[ix], payer, &[]).expect("create ATA");
    address
}

fn mint_to(svm: &mut LiteSVM, env_fee: &Keypair, authority: &Keypair, mint: &Pubkey, to: &Pubkey, amount: u64) {
    let mut data = vec![14u8]; // MintToChecked
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(8);
    let ix = Instruction {
        program_id: TOKEN_2022,
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(authority.pubkey(), true),
        ],
        data,
    };
    send(svm, &[ix], env_fee, &[authority]).expect("mint shares");
}

/// A live program: the real Token-2022 and ATA binaries, real xStock mints, the vault
/// initialised and AAPLx + NVDAx allowlisted. Alice and Bob each hold 10 shares of both.
fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(TOKEN_2022, &fixture("token_2022.so"));
    let _ = svm.add_program(ATA_PROGRAM, &fixture("associated_token.so"));
    let _ = svm.add_program(folio_vault::ID, &program_so());

    let env = Env {
        admin: admin_keypair(),
        fee: Keypair::new(),
        alice: Keypair::new(),
        bob: Keypair::new(),
        carol: Keypair::new(),
        mint_authority: Keypair::new(),
        svm,
    };
    let mut env = env;
    for k in [&env.admin, &env.fee, &env.alice, &env.bob, &env.carol] {
        env.svm.airdrop(&k.pubkey(), 10_000_000_000).expect("airdrop");
    }
    let authority = env.mint_authority.pubkey();
    load_mint(&mut env.svm, AAPLX, "aaplx.mint.bin", &authority);
    load_mint(&mut env.svm, NVDAX, "nvdax.mint.bin", &authority);
    load_mint(&mut env.svm, TSLAX, "tslax.mint.bin", &authority);

    let admin = env.admin.pubkey();
    send(&mut env.svm, &[ix_initialize(&admin)], &env.admin, &[]).expect("initialize");
    send(
        &mut env.svm,
        &[ix_set_asset(&admin, &AAPLX, true, CAP), ix_set_asset(&admin, &NVDAX, true, CAP)],
        &env.admin,
        &[],
    )
    .expect("allowlist");

    for who in [env.alice.pubkey(), env.bob.pubkey()] {
        for mint in [AAPLX, NVDAX] {
            let account = create_ata(&mut env.svm, &env.fee, &who, &mint);
            let (fee, auth) = (env.fee.insecure_clone(), env.mint_authority.insecure_clone());
            mint_to(&mut env.svm, &fee, &auth, &mint, &account, 10 * SHARE);
        }
    }
    env
}

/// Alice keeps a folio holding `amount` of AAPLx, sponsored by the fee payer.
fn alice_keeps(env: &mut Env, nonce: u64, unlock_at: i64, amount: u64) -> Pubkey {
    let alice = env.alice.pubkey();
    let fee = env.fee.pubkey();
    let key = folio_pda(&alice, nonce);
    send(
        &mut env.svm,
        &[
            ix_create(&alice, &fee, nonce, "Ada school", unlock_at, 0, NO_KEY, Some(alice)),
            ix_deposit(&key, &AAPLX, &alice, &fee, amount),
        ],
        &env.fee,
        &[&env.alice],
    )
    .expect("create and fund");
    key
}

// ------------------------------------------------------------------- tests

#[test]
fn real_xstock_mints_load_with_their_extensions() {
    let env = setup();
    let mint = env.svm.get_account(&AAPLX).unwrap();
    assert_eq!(mint.owner, TOKEN_2022);
    assert_eq!(mint.data[44], 8, "xStocks have 8 decimals");
    assert!(mint.data.len() > 165, "extensions follow the base mint");
}

#[test]
fn only_the_hard_coded_admin_can_initialise() {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(folio_vault::ID, &program_so());
    let impostor = Keypair::new();
    svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    expect_err(send(&mut svm, &[ix_initialize(&impostor.pubkey())], &impostor, &[]), "NotAdmin");
}

#[test]
fn keeps_a_folio_and_credits_what_actually_arrived() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 5);

    assert_eq!(token_amount(&env.svm, &ata(&key, &AAPLX)), SHARE / 5);
    let f = folio(&env.svm, &key);
    assert_eq!(f.owner, env.alice.pubkey());
    assert_eq!(f.creator, env.alice.pubkey());
    assert_eq!(f.rent_payer, env.fee.pubkey(), "the sponsor is recorded as rent payer");
    assert!(!f.escrowed);
    assert_eq!(f.name, "Ada school");
    assert_eq!(f.asset_count, 1);
    assert_eq!(f.assets[0], AAPLX);
    assert_eq!(f.policy_hash, POLICY);
}

#[test]
fn refuses_assets_that_are_not_allowed() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let admin = env.admin.pubkey();
    send(&mut env.svm, &[ix_set_asset(&admin, &NVDAX, false, CAP)], &env.admin, &[]).unwrap();
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    expect_err(
        send(&mut env.svm, &[ix_deposit(&key, &NVDAX, &alice, &fee, SHARE / 10)], &env.fee, &[&env.alice]),
        "AssetNotAllowed",
    );
}

#[test]
fn a_mint_never_configured_cannot_be_deposited() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    // TSLAx was never allowlisted, so its asset config account does not exist.
    expect_err(
        send(&mut env.svm, &[ix_deposit(&key, &TSLAX, &alice, &fee, 1)], &env.fee, &[&env.alice]),
        "AccountNotInitialized",
    );
}

#[test]
fn enforces_the_per_folio_cap_across_top_ups() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE * 4 / 10);
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    expect_err(
        send(&mut env.svm, &[ix_deposit(&key, &AAPLX, &alice, &fee, SHARE / 5)], &env.fee, &[&env.alice]),
        "AssetCapExceeded",
    );
    send(&mut env.svm, &[ix_deposit(&key, &AAPLX, &alice, &fee, SHARE / 10)], &env.fee, &[&env.alice])
        .expect("topping up to exactly the cap is fine");
    assert_eq!(token_amount(&env.svm, &ata(&key, &AAPLX)), CAP);
}

#[test]
fn a_lock_blocks_withdrawal_until_its_date() {
    let mut env = setup();
    let unlock = now(&env.svm) + 30 * DAY;
    let key = alice_keeps(&mut env, 1, unlock, SHARE / 5);
    let alice = env.alice.pubkey();
    let dest = ata(&alice, &AAPLX);

    expect_err(
        send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &alice, &dest, SHARE / 5)], &env.fee, &[&env.alice]),
        "Locked",
    );
    warp(&mut env.svm, 30 * DAY + 1);
    let before = token_amount(&env.svm, &dest);
    send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &alice, &dest, SHARE / 5)], &env.fee, &[&env.alice]).unwrap();
    assert_eq!(token_amount(&env.svm, &dest) - before, SHARE / 5);
    assert_eq!(token_amount(&env.svm, &ata(&key, &AAPLX)), 0);
}

#[test]
fn a_lock_can_move_later_but_never_earlier() {
    let mut env = setup();
    let unlock = now(&env.svm) + 30 * DAY;
    let key = alice_keeps(&mut env, 1, unlock, SHARE / 10);
    let alice = env.alice.pubkey();
    expect_err(
        send(&mut env.svm, &[ix_extend(&key, &alice, unlock - DAY)], &env.fee, &[&env.alice]),
        "LockNotExtendable",
    );
    send(&mut env.svm, &[ix_extend(&key, &alice, unlock + DAY)], &env.fee, &[&env.alice]).unwrap();
    assert_eq!(folio(&env.svm, &key).unlock_at, unlock + DAY);
}

#[test]
fn only_the_owner_can_withdraw() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let bob = env.bob.pubkey();
    let dest = ata(&bob, &AAPLX);
    expect_err(
        send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &bob, &dest, 1)], &env.fee, &[&env.bob]),
        "NotOwner",
    );
}

#[test]
fn a_direct_gift_is_owned_at_once_but_stays_locked() {
    let mut env = setup();
    let (alice, bob, fee) = (env.alice.pubkey(), env.bob.pubkey(), env.fee.pubkey());
    let unlock = now(&env.svm) + 365 * DAY;
    let key = folio_pda(&alice, 9);
    send(
        &mut env.svm,
        &[
            ix_create(&alice, &fee, 9, "Amara 2028", unlock, 0, NO_KEY, Some(bob)),
            ix_deposit(&key, &AAPLX, &alice, &fee, SHARE / 10),
        ],
        &env.fee,
        &[&env.alice],
    )
    .unwrap();
    assert_eq!(folio(&env.svm, &key).owner, bob, "the recipient owns it from creation");
    let dest = ata(&bob, &AAPLX);
    expect_err(
        send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &bob, &dest, 1)], &env.fee, &[&env.bob]),
        "Locked",
    );
}

#[test]
fn a_claim_link_needs_its_own_key_and_works_once() {
    let mut env = setup();
    let (alice, bob, carol, fee) = (env.alice.pubkey(), env.bob.pubkey(), env.carol.pubkey(), env.fee.pubkey());
    let link = Keypair::new();
    let key = folio_pda(&alice, 5);
    send(
        &mut env.svm,
        &[
            ix_create(&alice, &fee, 5, "Claim me", 0, 0, link.pubkey(), None),
            ix_deposit(&key, &AAPLX, &alice, &fee, SHARE / 10),
        ],
        &env.fee,
        &[&env.alice],
    )
    .unwrap();
    let f = folio(&env.svm, &key);
    assert!(f.escrowed);
    assert_eq!(f.owner, NO_KEY);

    let wrong = Keypair::new();
    expect_err(
        send(&mut env.svm, &[ix_claim(&key, &wrong.pubkey(), &carol)], &env.fee, &[&wrong, &env.carol]),
        "WrongClaimKey",
    );

    send(&mut env.svm, &[ix_claim(&key, &link.pubkey(), &bob)], &env.fee, &[&link, &env.bob]).unwrap();
    let f = folio(&env.svm, &key);
    assert_eq!(f.owner, bob);
    assert!(!f.escrowed);

    // The link is spent: presenting it again gets nothing.
    expect_err(
        send(&mut env.svm, &[ix_claim(&key, &link.pubkey(), &carol)], &env.fee, &[&link, &env.carol]),
        "NotEscrowed",
    );
}

#[test]
fn an_unclaimed_gift_returns_to_its_creator_after_the_window() {
    let mut env = setup();
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    let link = Keypair::new();
    let t = now(&env.svm);
    let key = folio_pda(&alice, 6);
    send(
        &mut env.svm,
        &[
            ix_create(&alice, &fee, 6, "Unclaimed", t + 365 * DAY, t + 14 * DAY, link.pubkey(), None),
            ix_deposit(&key, &AAPLX, &alice, &fee, SHARE / 10),
        ],
        &env.fee,
        &[&env.alice],
    )
    .unwrap();

    expect_err(send(&mut env.svm, &[ix_reclaim(&key, &alice)], &env.fee, &[&env.alice]), "NotReclaimable");
    warp(&mut env.svm, 14 * DAY + 1);
    send(&mut env.svm, &[ix_reclaim(&key, &alice)], &env.fee, &[&env.alice]).unwrap();

    let f = folio(&env.svm, &key);
    assert_eq!(f.owner, alice);
    assert_eq!(f.unlock_at, 0, "a reclaimed gift is usable by its funder at once");
    let dest = ata(&alice, &AAPLX);
    send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &alice, &dest, SHARE / 10)], &env.fee, &[&env.alice]).unwrap();
}

#[test]
fn a_folio_can_be_handed_on_and_its_lock_travels_with_it() {
    let mut env = setup();
    let unlock = now(&env.svm) + 30 * DAY;
    let key = alice_keeps(&mut env, 1, unlock, SHARE / 10);
    let (alice, bob) = (env.alice.pubkey(), env.bob.pubkey());
    send(&mut env.svm, &[ix_transfer(&key, &alice, bob)], &env.fee, &[&env.alice]).unwrap();
    assert_eq!(folio(&env.svm, &key).owner, bob);
    let dest = ata(&bob, &AAPLX);
    expect_err(send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &bob, &dest, 1)], &env.fee, &[&env.bob]), "Locked");
}

#[test]
fn pausing_stops_new_money_but_never_traps_existing_money() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let (alice, bob, fee, admin) = (env.alice.pubkey(), env.bob.pubkey(), env.fee.pubkey(), env.admin.pubkey());

    // An escrowed gift made before the pause.
    let link = Keypair::new();
    let gift = folio_pda(&alice, 2);
    send(
        &mut env.svm,
        &[ix_create(&alice, &fee, 2, "Before pause", 0, 0, link.pubkey(), None), ix_deposit(&gift, &AAPLX, &alice, &fee, SHARE / 10)],
        &env.fee,
        &[&env.alice],
    )
    .unwrap();

    send(&mut env.svm, &[ix_set_paused(&admin, true)], &env.admin, &[]).unwrap();

    expect_err(
        send(&mut env.svm, &[ix_create(&alice, &fee, 3, "During", 0, 0, NO_KEY, Some(alice))], &env.fee, &[&env.alice]),
        "Paused",
    );
    expect_err(
        send(&mut env.svm, &[ix_deposit(&key, &AAPLX, &alice, &fee, 1)], &env.fee, &[&env.alice]),
        "Paused",
    );

    // Reaching money that is already here keeps working.
    let dest = ata(&alice, &AAPLX);
    send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &alice, &dest, SHARE / 10)], &env.fee, &[&env.alice])
        .expect("withdraw works while paused");
    send(&mut env.svm, &[ix_claim(&gift, &link.pubkey(), &bob)], &env.fee, &[&link, &env.bob])
        .expect("claim works while paused");
}

#[test]
fn closing_returns_deposits_to_whoever_paid_never_the_caller() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    let dest = ata(&alice, &AAPLX);
    send(&mut env.svm, &[ix_withdraw(&key, &AAPLX, &alice, &dest, SHARE / 10)], &env.fee, &[&env.alice]).unwrap();

    // Alice owns the folio, but the sponsor paid the deposits — she cannot redirect them.
    expect_err(
        send(&mut env.svm, &[ix_close_vault(&key, &AAPLX, &alice, &alice)], &env.alice, &[]),
        "WrongRentPayer",
    );

    // Alice pays this fee herself, so the sponsor's balance moves only by refunds.
    let before = lamports(&env.svm, &fee);
    send(&mut env.svm, &[ix_close_vault(&key, &AAPLX, &alice, &fee)], &env.alice, &[]).unwrap();
    let after_vault = lamports(&env.svm, &fee);
    assert!(after_vault > before, "vault deposit returned to the sponsor");

    send(&mut env.svm, &[ix_close_folio(&key, &alice, &fee)], &env.alice, &[]).unwrap();
    assert!(lamports(&env.svm, &fee) > after_vault, "folio deposit returned to the sponsor");
    assert!(env.svm.get_account(&key).map(|a| a.data.is_empty()).unwrap_or(true), "folio is gone");
}

#[test]
fn cannot_close_a_folio_that_still_holds_something() {
    let mut env = setup();
    let key = alice_keeps(&mut env, 1, 0, SHARE / 10);
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    expect_err(send(&mut env.svm, &[ix_close_folio(&key, &alice, &fee)], &env.alice, &[]), "FolioNotEmpty");
    expect_err(send(&mut env.svm, &[ix_close_vault(&key, &AAPLX, &alice, &fee)], &env.alice, &[]), "VaultNotEmpty");
}

/// An empty folio with its AAPLx vault opened — the state a purchase starts from.
fn empty_folio_with_vault(env: &mut Env, nonce: u64, mint: &Pubkey) -> (Pubkey, Pubkey) {
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    let key = folio_pda(&alice, nonce);
    send(&mut env.svm, &[ix_create(&alice, &fee, nonce, "Bought", 0, 0, NO_KEY, Some(alice))], &env.fee, &[&env.alice])
        .unwrap();
    let fee_kp = env.fee.insecure_clone();
    let vault = create_ata(&mut env.svm, &fee_kp, &key, mint);
    (key, vault)
}

#[test]
fn a_swap_paid_straight_into_the_vault_is_recorded_and_capped() {
    let mut env = setup();
    let (key, vault) = empty_folio_with_vault(&mut env, 1, &AAPLX);
    let (fee, auth) = (env.fee.insecure_clone(), env.mint_authority.insecure_clone());

    // What Jupiter does in production: pay the swap's output directly into the vault.
    mint_to(&mut env.svm, &fee, &auth, &AAPLX, &vault, SHARE / 5);
    send(&mut env.svm, &[ix_sync(&key, &AAPLX)], &env.fee, &[]).expect("sync records the arrival");
    let f = folio(&env.svm, &key);
    assert_eq!(f.asset_count, 1);
    assert_eq!(f.assets[0], AAPLX);

    // Past the cap, sync refuses — in production that reverts the whole purchase.
    mint_to(&mut env.svm, &fee, &auth, &AAPLX, &vault, SHARE / 2);
    expect_err(send(&mut env.svm, &[ix_sync(&key, &AAPLX)], &env.fee, &[]), "AssetCapExceeded");
}

#[test]
fn sync_refuses_a_mint_that_is_not_allowed() {
    let mut env = setup();
    let admin = env.admin.pubkey();
    send(&mut env.svm, &[ix_set_asset(&admin, &NVDAX, false, CAP)], &env.admin, &[]).unwrap();
    let (key, vault) = empty_folio_with_vault(&mut env, 1, &NVDAX);
    let (fee, auth) = (env.fee.insecure_clone(), env.mint_authority.insecure_clone());
    mint_to(&mut env.svm, &fee, &auth, &NVDAX, &vault, SHARE / 10);
    expect_err(send(&mut env.svm, &[ix_sync(&key, &NVDAX)], &env.fee, &[]), "AssetNotAllowed");
}

#[test]
fn sync_refuses_while_paused_so_new_purchases_stop() {
    let mut env = setup();
    let (key, vault) = empty_folio_with_vault(&mut env, 1, &AAPLX);
    let (fee, auth) = (env.fee.insecure_clone(), env.mint_authority.insecure_clone());
    mint_to(&mut env.svm, &fee, &auth, &AAPLX, &vault, SHARE / 10);
    let admin = env.admin.pubkey();
    send(&mut env.svm, &[ix_set_paused(&admin, true)], &env.admin, &[]).unwrap();
    expect_err(send(&mut env.svm, &[ix_sync(&key, &AAPLX)], &env.fee, &[]), "Paused");
}

#[test]
fn names_are_bounded() {
    let mut env = setup();
    let (alice, fee) = (env.alice.pubkey(), env.fee.pubkey());
    let long = "x".repeat(41);
    expect_err(
        send(&mut env.svm, &[ix_create(&alice, &fee, 1, &long, 0, 0, NO_KEY, Some(alice))], &env.fee, &[&env.alice]),
        "NameTooLong",
    );
}
