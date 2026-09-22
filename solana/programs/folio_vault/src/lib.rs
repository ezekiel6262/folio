//! Folio vault.
//!
//! A folio is a named basket of tokenized stocks held by this program in its owner's
//! name. The program does four things and nothing else: it holds tokens, records who
//! they belong to, enforces an optional unlock date, and lets a folio be handed to
//! someone else — directly, or through a claim link.
//!
//! It is not an issuer, a broker or a price oracle. The xStocks it holds carry their
//! issuer's own powers (freeze, pause and a permanent delegate that can move tokens out
//! of any account, including these vaults). The program cannot override those and does
//! not pretend to.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("GJY26YALBaMdimL4Kk4Abo26BNkrSVMrC2wA46TRoXnD");

/// The only key that may initialise the program. Hard-coded so nobody can front-run
/// `initialize` after deployment and make themselves admin.
pub const ADMIN: Pubkey = pubkey!("D3agrnhRwhHuni37ujsHCcmQHGznN8UxwtWwLzZQKq9G");

pub const MAX_NAME_LEN: usize = 40;
/// Distinct companies one folio may hold, so every folio stays enumerable and bounded.
pub const MAX_ASSETS: usize = 8;

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const FOLIO_SEED: &[u8] = b"folio";

#[program]
pub mod folio_vault {
    use super::*;

    // ------------------------------------------------------------------ admin

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Allow or forbid a mint, and set the most raw units of it one folio may hold.
    /// The cap is explicit on purpose: this code is unaudited, so the vault is sized
    /// to hold a demonstrable amount, not an unbounded one.
    pub fn set_asset(ctx: Context<SetAsset>, allowed: bool, cap: u64) -> Result<()> {
        let asset = &mut ctx.accounts.asset;
        asset.mint = ctx.accounts.mint.key();
        asset.allowed = allowed;
        asset.cap = cap;
        asset.bump = ctx.bumps.asset;
        emit!(AssetConfigured { mint: asset.mint, allowed, cap });
        Ok(())
    }

    /// Pausing stops new money coming in. It never stops anyone reaching money that is
    /// already here: claim, reclaim, withdraw and close all keep working.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }

    // ------------------------------------------------------------- lifecycle

    /// Create an empty folio. Moving no money, this is safe to send as its own
    /// transaction ahead of the purchase: if the purchase then fails, the user is left
    /// with an empty folio they can close, never with half-spent funds.
    ///
    /// `recipient` = Some(key) gives it straight to `key` (the creator, to keep it).
    /// `recipient` = None escrows it for a claim link, which requires `claim_key`.
    pub fn create_folio(
        ctx: Context<CreateFolio>,
        nonce: u64,
        name: String,
        unlock_at: i64,
        reclaim_after: i64,
        claim_key: Pubkey,
        policy_hash: [u8; 32],
        recipient: Option<Pubkey>,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, FolioError::Paused);
        require!(name.len() <= MAX_NAME_LEN, FolioError::NameTooLong);

        let escrowed = recipient.is_none();
        if escrowed {
            require!(claim_key != Pubkey::default(), FolioError::MissingClaimKey);
        } else {
            require!(recipient != Some(Pubkey::default()), FolioError::InvalidRecipient);
        }

        let folio = &mut ctx.accounts.folio;
        folio.owner = recipient.unwrap_or_default();
        folio.creator = ctx.accounts.creator.key();
        folio.rent_payer = ctx.accounts.payer.key();
        folio.claim_key = if escrowed { claim_key } else { Pubkey::default() };
        folio.policy_hash = policy_hash;
        folio.created_at = Clock::get()?.unix_timestamp;
        folio.unlock_at = unlock_at;
        folio.reclaim_after = reclaim_after;
        folio.nonce = nonce;
        folio.escrowed = escrowed;
        folio.bump = ctx.bumps.folio;
        folio.asset_count = 0;
        folio.assets = [Pubkey::default(); MAX_ASSETS];
        folio.name = name.clone();

        emit!(FolioCreated {
            folio: folio.key(),
            creator: folio.creator,
            owner: folio.owner,
            escrowed,
            unlock_at,
            name,
        });
        Ok(())
    }

    /// Move tokens from the depositor into the folio's vault. Anyone may top up any
    /// folio, including a locked or escrowed one.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, FolioError::Paused);
        require!(amount > 0, FolioError::ZeroAmount);
        let allowed = ctx.accounts.asset.allowed;
        let cap = ctx.accounts.asset.cap;
        require!(allowed, FolioError::AssetNotAllowed);

        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.depositor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        // Credit what actually arrived, not what was asked for, and cap on the real
        // balance. The vault's own balance is the source of truth — the issuer's
        // permanent delegate can move tokens out, so a stored running total could drift.
        ctx.accounts.vault.reload()?;
        let after = ctx.accounts.vault.amount;
        let received = after.checked_sub(before).ok_or(FolioError::MathOverflow)?;
        require!(received > 0, FolioError::ZeroAmount);
        require!(after <= cap, FolioError::AssetCapExceeded);

        let mint = ctx.accounts.mint.key();
        let folio = &mut ctx.accounts.folio;
        folio.track(mint)?;

        emit!(FolioFunded {
            folio: folio.key(),
            funder: ctx.accounts.depositor.key(),
            mint,
            amount: received,
        });
        Ok(())
    }

    /// Record what a swap paid straight into a folio's vault, and enforce the cap on the
    /// real balance. Purchases route the swap's output directly into the vault, so no
    /// stock ever sits loose in the buyer's wallet; this is the step that makes it count.
    /// If the cap would be breached it fails, and because it runs in the same transaction
    /// as the swap, the whole purchase reverts. Permissionless: it only records and checks.
    pub fn sync_vault(ctx: Context<SyncVault>) -> Result<()> {
        require!(!ctx.accounts.config.paused, FolioError::Paused);
        require!(ctx.accounts.asset.allowed, FolioError::AssetNotAllowed);
        let balance = ctx.accounts.vault.amount;
        require!(balance > 0, FolioError::ZeroAmount);
        require!(balance <= ctx.accounts.asset.cap, FolioError::AssetCapExceeded);

        let mint = ctx.accounts.mint.key();
        let folio = &mut ctx.accounts.folio;
        folio.track(mint)?;
        emit!(FolioSynced { folio: folio.key(), mint, balance });
        Ok(())
    }

    /// Take an escrowed folio. The claim link carries a signing key, not a secret to be
    /// revealed: its signature covers the whole transaction, including who is claiming,
    /// so a block producer who sees the transaction cannot re-point it at themselves.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let folio = &mut ctx.accounts.folio;
        require!(folio.escrowed, FolioError::NotEscrowed);
        require_keys_eq!(ctx.accounts.claim_key.key(), folio.claim_key, FolioError::WrongClaimKey);

        folio.owner = ctx.accounts.claimant.key();
        folio.escrowed = false;
        folio.claim_key = Pubkey::default();

        emit!(FolioClaimed { folio: folio.key(), claimant: folio.owner });
        Ok(())
    }

    /// Return an unclaimed gift to whoever made it, once its window has passed. A
    /// reclaimed gift is immediately usable — its funder is not locked out of it.
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        let folio = &mut ctx.accounts.folio;
        require!(folio.escrowed, FolioError::NotEscrowed);
        let now = Clock::get()?.unix_timestamp;
        require!(folio.reclaim_after != 0 && now >= folio.reclaim_after, FolioError::NotReclaimable);

        folio.owner = folio.creator;
        folio.escrowed = false;
        folio.claim_key = Pubkey::default();
        folio.unlock_at = 0;

        emit!(FolioReclaimed { folio: folio.key(), creator: folio.creator });
        Ok(())
    }

    /// Give a folio you own to someone else. Any lock travels with it.
    pub fn transfer_folio(ctx: Context<OwnerOnly>, new_owner: Pubkey) -> Result<()> {
        require!(new_owner != Pubkey::default(), FolioError::InvalidRecipient);
        let folio = &mut ctx.accounts.folio;
        let previous = folio.owner;
        folio.owner = new_owner;
        emit!(FolioTransferred { folio: folio.key(), from: previous, to: new_owner });
        Ok(())
    }

    /// Push the unlock date further out. It can never be brought closer.
    pub fn extend_lock(ctx: Context<OwnerOnly>, new_unlock_at: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let folio = &mut ctx.accounts.folio;
        require!(new_unlock_at > folio.unlock_at && new_unlock_at > now, FolioError::LockNotExtendable);
        let previous = folio.unlock_at;
        folio.unlock_at = new_unlock_at;
        emit!(LockExtended { folio: folio.key(), previous, new_unlock_at });
        Ok(())
    }

    /// Move tokens out of an unlocked folio you own, to any token account you choose.
    /// Selling is this followed by a swap in the same transaction.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, FolioError::ZeroAmount);
        require!(amount <= ctx.accounts.vault.amount, FolioError::InsufficientVault);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.folio.unlock_at, FolioError::Locked);

        let folio = &ctx.accounts.folio;
        let nonce = folio.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[FOLIO_SEED, folio.creator.as_ref(), &nonce, &[folio.bump]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.folio.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Withdrawn {
            folio: ctx.accounts.folio.key(),
            to: ctx.accounts.destination.key(),
            mint: ctx.accounts.mint.key(),
            amount,
        });
        Ok(())
    }

    /// Close an emptied vault. Its deposit goes back to whoever paid for it — never to
    /// the caller — so sponsoring account deposits cannot be farmed by open/close cycles.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        require!(ctx.accounts.vault.amount == 0, FolioError::VaultNotEmpty);

        let folio = &ctx.accounts.folio;
        let nonce = folio.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[FOLIO_SEED, folio.creator.as_ref(), &nonce, &[folio.bump]];

        token_interface::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.rent_payer.to_account_info(),
                authority: ctx.accounts.folio.to_account_info(),
            },
            &[seeds],
        ))?;

        let mint = ctx.accounts.mint.key();
        ctx.accounts.folio.untrack(mint);
        Ok(())
    }

    /// Close a folio whose vaults are all closed. Its deposit returns to whoever paid.
    pub fn close_folio(_ctx: Context<CloseFolio>) -> Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
    #[account(mut, address = ADMIN @ FolioError::NotAdmin)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAsset<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FolioError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AssetConfig::INIT_SPACE,
        seeds = [ASSET_SEED, mint.key().as_ref()],
        bump,
    )]
    pub asset: Account<'info, AssetConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ FolioError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateFolio<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = 8 + Folio::INIT_SPACE,
        seeds = [FOLIO_SEED, creator.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub folio: Account<'info, Folio>,
    pub creator: Signer<'info>,
    /// Pays the account deposit. In sponsored mode this is the app's fee payer, and it
    /// is recorded so the deposit can only ever be returned to it.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
    )]
    pub folio: Account<'info, Folio>,
    #[account(seeds = [ASSET_SEED, mint.key().as_ref()], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = depositor,
        token::token_program = token_program,
    )]
    pub depositor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = folio,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SyncVault<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
    )]
    pub folio: Account<'info, Folio>,
    #[account(seeds = [ASSET_SEED, mint.key().as_ref()], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        associated_token::mint = mint,
        associated_token::authority = folio,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
    )]
    pub folio: Account<'info, Folio>,
    /// The key carried in the claim link. Its signature is the proof of possession.
    pub claim_key: Signer<'info>,
    pub claimant: Signer<'info>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
        has_one = creator @ FolioError::NotCreator,
    )]
    pub folio: Account<'info, Folio>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
        has_one = owner @ FolioError::NotOwner,
        constraint = !folio.escrowed @ FolioError::Escrowed,
    )]
    pub folio: Account<'info, Folio>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
        has_one = owner @ FolioError::NotOwner,
        constraint = !folio.escrowed @ FolioError::Escrowed,
    )]
    pub folio: Account<'info, Folio>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = folio,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        mut,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
        has_one = owner @ FolioError::NotOwner,
        has_one = rent_payer @ FolioError::WrongRentPayer,
        constraint = !folio.escrowed @ FolioError::Escrowed,
    )]
    pub folio: Account<'info, Folio>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = folio,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: constrained to `folio.rent_payer` by `has_one`; only receives lamports.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseFolio<'info> {
    #[account(
        mut,
        close = rent_payer,
        seeds = [FOLIO_SEED, folio.creator.as_ref(), &folio.nonce.to_le_bytes()],
        bump = folio.bump,
        has_one = owner @ FolioError::NotOwner,
        has_one = rent_payer @ FolioError::WrongRentPayer,
        constraint = !folio.escrowed @ FolioError::Escrowed,
        constraint = folio.asset_count == 0 @ FolioError::FolioNotEmpty,
    )]
    pub folio: Account<'info, Folio>,
    /// CHECK: constrained to `folio.rent_payer` by `has_one`; only receives lamports.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
    pub owner: Signer<'info>,
}

// ------------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AssetConfig {
    pub mint: Pubkey,
    pub allowed: bool,
    /// Max raw units one folio may hold of this mint.
    pub cap: u64,
    pub bump: u8,
}

/// Field order is part of the interface: `owner` sits at byte 8 and `creator` at byte
/// 40 so clients can list "folios I own" and "gifts I made" with a single memcmp filter.
#[account]
#[derive(InitSpace)]
pub struct Folio {
    /// Pubkey::default() while escrowed behind a claim link.
    pub owner: Pubkey,
    pub creator: Pubkey,
    /// Paid the account deposits; the only address those deposits are ever returned to.
    pub rent_payer: Pubkey,
    /// Public half of the claim link's key. Pubkey::default() once claimed or if unused.
    pub claim_key: Pubkey,
    /// Commitment to the off-chain allocation policy that produced this basket.
    pub policy_hash: [u8; 32],
    pub created_at: i64,
    pub unlock_at: i64,
    pub reclaim_after: i64,
    pub nonce: u64,
    pub escrowed: bool,
    pub bump: u8,
    pub asset_count: u8,
    pub assets: [Pubkey; MAX_ASSETS],
    #[max_len(40)]
    pub name: String,
}

impl Folio {
    fn track(&mut self, mint: Pubkey) -> Result<()> {
        let n = self.asset_count as usize;
        if self.assets[..n].contains(&mint) {
            return Ok(());
        }
        require!(n < MAX_ASSETS, FolioError::TooManyAssets);
        self.assets[n] = mint;
        self.asset_count += 1;
        Ok(())
    }

    fn untrack(&mut self, mint: Pubkey) {
        let n = self.asset_count as usize;
        if let Some(i) = self.assets[..n].iter().position(|m| *m == mint) {
            self.assets[i] = self.assets[n - 1];
            self.assets[n - 1] = Pubkey::default();
            self.asset_count -= 1;
        }
    }
}

// ------------------------------------------------------------------ events

#[event]
pub struct AssetConfigured {
    pub mint: Pubkey,
    pub allowed: bool,
    pub cap: u64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[event]
pub struct FolioCreated {
    pub folio: Pubkey,
    pub creator: Pubkey,
    pub owner: Pubkey,
    pub escrowed: bool,
    pub unlock_at: i64,
    pub name: String,
}

#[event]
pub struct FolioFunded {
    pub folio: Pubkey,
    pub funder: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FolioSynced {
    pub folio: Pubkey,
    pub mint: Pubkey,
    pub balance: u64,
}

#[event]
pub struct FolioClaimed {
    pub folio: Pubkey,
    pub claimant: Pubkey,
}

#[event]
pub struct FolioReclaimed {
    pub folio: Pubkey,
    pub creator: Pubkey,
}

#[event]
pub struct FolioTransferred {
    pub folio: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[event]
pub struct LockExtended {
    pub folio: Pubkey,
    pub previous: i64,
    pub new_unlock_at: i64,
}

#[event]
pub struct Withdrawn {
    pub folio: Pubkey,
    pub to: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

// ------------------------------------------------------------------ errors

#[error_code]
pub enum FolioError {
    #[msg("Only the admin can do that")]
    NotAdmin,
    #[msg("New folios and deposits are paused")]
    Paused,
    #[msg("Folio names are at most 40 bytes")]
    NameTooLong,
    #[msg("A claim-link folio needs a claim key")]
    MissingClaimKey,
    #[msg("That is not a valid recipient")]
    InvalidRecipient,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("That asset is not on the allowlist")]
    AssetNotAllowed,
    #[msg("That would exceed this asset's per-folio cap")]
    AssetCapExceeded,
    #[msg("A folio can hold at most 8 different assets")]
    TooManyAssets,
    #[msg("That folio is not waiting to be claimed")]
    NotEscrowed,
    #[msg("That folio is still waiting to be claimed")]
    Escrowed,
    #[msg("That claim key does not match this folio")]
    WrongClaimKey,
    #[msg("Only the folio's owner can do that")]
    NotOwner,
    #[msg("Only the folio's creator can do that")]
    NotCreator,
    #[msg("This folio is locked until its unlock date")]
    Locked,
    #[msg("This gift cannot be reclaimed yet")]
    NotReclaimable,
    #[msg("A lock can only be pushed later, never earlier")]
    LockNotExtendable,
    #[msg("The vault does not hold that much")]
    InsufficientVault,
    #[msg("Empty the vault before closing it")]
    VaultNotEmpty,
    #[msg("Close every vault before closing the folio")]
    FolioNotEmpty,
    #[msg("Deposits can only be returned to whoever paid them")]
    WrongRentPayer,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
