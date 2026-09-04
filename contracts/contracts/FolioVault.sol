// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title FolioVault
/// @notice A Folio is a named, ownable basket of tokenized stocks held in escrow by this
///         contract. Ownership of the basket is an ERC-721, so a Folio can be gifted the
///         same way any NFT can, while the assets themselves never leave the vault.
///
/// Two gifting shapes are supported:
///   1. Direct  - mint straight to the recipient. They see the Folio immediately, but
///                cannot withdraw until `unlockAt`. This is the "you have money waiting"
///                experience: visible the whole time, spendable later.
///   2. Claim   - mint into escrow against keccak256(secret). Whoever presents the
///                secret takes ownership. If nobody claims by `reclaimAfter`, the funder
///                takes it back.
///
/// Deposits are restricted to an explicit allowlist with an explicit per-Folio cap per
/// asset. Both are set by the owner. This contract is deliberately not an issuer, a
/// broker, or a price oracle: it holds tokens and records who they belong to.
contract FolioVault is ERC721, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    struct Folio {
        address creator; // who funded it originally
        uint64 createdAt;
        uint64 unlockAt; // withdrawals revert before this timestamp
        uint64 reclaimAfter; // 0 = never reclaimable
        bytes32 claimHash; // 0 once claimed, or if minted directly
        bytes32 policyHash; // commitment to the offchain allocation policy
        string name;
    }

    struct Contribution {
        address token;
        uint256 amount;
    }

    struct AssetConfig {
        bool allowed;
        uint256 cap; // max units of this asset a single Folio may hold
    }

    // ---------------------------------------------------------------- state

    uint256 public nextFolioId = 1;

    mapping(uint256 => Folio) private _folios;
    mapping(address => AssetConfig) public assetConfig;

    /// @dev folioId => token => units held for that Folio
    mapping(uint256 => mapping(address => uint256)) public holdings;
    mapping(uint256 => address[]) private _assetList;
    mapping(uint256 => mapping(address => bool)) private _tracked;

    /// @dev Cap on distinct assets per Folio, so views and withdrawals stay bounded.
    uint256 public constant MAX_ASSETS_PER_FOLIO = 12;

    // --------------------------------------------------------------- events

    event AssetConfigured(address indexed token, bool allowed, uint256 cap);
    event FolioCreated(
        uint256 indexed folioId,
        address indexed creator,
        address indexed to,
        string name,
        uint64 unlockAt,
        bool escrowed
    );
    event FolioFunded(uint256 indexed folioId, address indexed funder, address indexed token, uint256 amount);
    event FolioClaimed(uint256 indexed folioId, address indexed claimant);
    event FolioReclaimed(uint256 indexed folioId, address indexed creator);
    event Withdrawn(uint256 indexed folioId, address indexed to, address indexed token, uint256 amount);
    event LockExtended(uint256 indexed folioId, uint64 previousUnlockAt, uint64 newUnlockAt);

    // --------------------------------------------------------------- errors

    error AssetNotAllowed(address token);
    error AssetCapExceeded(address token, uint256 attempted, uint256 cap);
    error TooManyAssets();
    error NoContributions();
    error ZeroAmount();
    error FolioLocked(uint64 unlockAt);
    error NotFolioOwner();
    error NotEscrowed();
    error BadSecret();
    error NotReclaimable();
    error NothingToWithdraw();
    error LockNotExtendable();
    error InvalidRecipient();
    error LengthMismatch();

    constructor(address initialOwner) ERC721("Folio", "FOLIO") Ownable(initialOwner) {}

    // ---------------------------------------------------------------- admin

    /// @notice Allow or forbid an asset, and set the maximum units one Folio may hold.
    /// @dev A cap of type(uint256).max means uncapped. The cap is intentionally
    ///      explicit: there is no implicit "unlimited" default.
    function setAsset(address token, bool allowed, uint256 cap) external onlyOwner {
        if (token == address(0)) revert InvalidRecipient();
        assetConfig[token] = AssetConfig({allowed: allowed, cap: cap});
        emit AssetConfigured(token, allowed, cap);
    }

    function setAssets(address[] calldata tokens, bool allowed, uint256[] calldata caps) external onlyOwner {
        if (tokens.length != caps.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == address(0)) revert InvalidRecipient();
            assetConfig[tokens[i]] = AssetConfig({allowed: allowed, cap: caps[i]});
            emit AssetConfigured(tokens[i], allowed, caps[i]);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // -------------------------------------------------------------- writing

    /// @notice Create a Folio and fund it in one call.
    /// @param to           Recipient of the Folio NFT. Pass address(0) to escrow it for a
    ///                     claim link, in which case `claimHash` must be non-zero.
    /// @param name         Human name, e.g. "Ada school". Stored onchain; it is the point.
    /// @param unlockAt     Withdrawals revert before this timestamp. 0 for no lock.
    /// @param reclaimAfter If escrowed and unclaimed past this, the creator can reclaim.
    /// @param claimHash    keccak256(abi.encodePacked(secret)) for claim-link gifts.
    /// @param policyHash   Commitment to the offchain allocation policy that produced this.
    function createFolio(
        address to,
        string calldata name,
        uint64 unlockAt,
        uint64 reclaimAfter,
        bytes32 claimHash,
        bytes32 policyHash,
        Contribution[] calldata contributions
    ) external nonReentrant whenNotPaused returns (uint256 folioId) {
        bool escrowed = to == address(0);
        if (escrowed && claimHash == bytes32(0)) revert InvalidRecipient();
        if (contributions.length == 0) revert NoContributions();

        folioId = nextFolioId++;
        _folios[folioId] = Folio({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            unlockAt: unlockAt,
            reclaimAfter: reclaimAfter,
            claimHash: escrowed ? claimHash : bytes32(0),
            policyHash: policyHash,
            name: name
        });

        // Escrowed folios are held by this contract. `_mint` rather than `_safeMint`:
        // the receiver is this contract, and only claim/reclaim can move it out.
        _mint(escrowed ? address(this) : to, folioId);

        _pullContributions(folioId, contributions);

        emit FolioCreated(folioId, msg.sender, escrowed ? address(this) : to, name, unlockAt, escrowed);
    }

    /// @notice Add more assets to an existing Folio. Anyone may top up any Folio.
    function fund(uint256 folioId, Contribution[] calldata contributions) external nonReentrant whenNotPaused {
        _requireOwned(folioId);
        if (contributions.length == 0) revert NoContributions();
        _pullContributions(folioId, contributions);
    }

    /// @notice Take ownership of an escrowed Folio by presenting its secret.
    function claim(uint256 folioId, bytes32 secret) external nonReentrant whenNotPaused {
        Folio storage f = _folios[folioId];
        if (_ownerOf(folioId) != address(this)) revert NotEscrowed();
        if (f.claimHash == bytes32(0)) revert NotEscrowed();
        if (keccak256(abi.encodePacked(secret)) != f.claimHash) revert BadSecret();

        f.claimHash = bytes32(0);
        _transfer(address(this), msg.sender, folioId);
        emit FolioClaimed(folioId, msg.sender);
    }

    /// @notice Return an unclaimed Folio to whoever funded it, once its window has passed.
    function reclaim(uint256 folioId) external nonReentrant {
        Folio storage f = _folios[folioId];
        if (_ownerOf(folioId) != address(this)) revert NotEscrowed();
        if (f.reclaimAfter == 0 || block.timestamp < f.reclaimAfter) revert NotReclaimable();

        address creator = f.creator;
        f.claimHash = bytes32(0);
        f.unlockAt = 0; // a reclaimed gift is immediately usable by its funder
        _transfer(address(this), creator, folioId);
        emit FolioReclaimed(folioId, creator);
    }

    /// @notice Withdraw specific assets from an unlocked Folio you own.
    function withdraw(uint256 folioId, address[] calldata tokens, uint256[] calldata amounts, address to)
        external
        nonReentrant
    {
        if (tokens.length != amounts.length) revert LengthMismatch();
        _authorizeWithdraw(folioId, to);
        for (uint256 i; i < tokens.length; ++i) {
            _payOut(folioId, tokens[i], amounts[i], to);
        }
    }

    /// @notice Withdraw everything from an unlocked Folio you own.
    function withdrawAll(uint256 folioId, address to) external nonReentrant {
        _authorizeWithdraw(folioId, to);
        address[] storage list = _assetList[folioId];
        uint256 moved;
        for (uint256 i; i < list.length; ++i) {
            address token = list[i];
            uint256 bal = holdings[folioId][token];
            if (bal == 0) continue;
            _payOut(folioId, token, bal, to);
            unchecked {
                ++moved;
            }
        }
        if (moved == 0) revert NothingToWithdraw();
    }

    /// @notice Push a Folio's unlock date further out. It can never be brought closer.
    function extendLock(uint256 folioId, uint64 newUnlockAt) external whenNotPaused {
        if (_requireOwned(folioId) != msg.sender) revert NotFolioOwner();
        Folio storage f = _folios[folioId];
        if (newUnlockAt <= f.unlockAt || newUnlockAt <= block.timestamp) revert LockNotExtendable();
        uint64 prev = f.unlockAt;
        f.unlockAt = newUnlockAt;
        emit LockExtended(folioId, prev, newUnlockAt);
    }

    // ------------------------------------------------------------- internal

    function _pullContributions(uint256 folioId, Contribution[] calldata contributions) private {
        for (uint256 i; i < contributions.length; ++i) {
            address token = contributions[i].token;
            uint256 amount = contributions[i].amount;
            if (amount == 0) revert ZeroAmount();

            AssetConfig memory cfg = assetConfig[token];
            if (!cfg.allowed) revert AssetNotAllowed(token);

            // Credit what actually arrived, not what was asked for. B20 assets are not
            // fee-on-transfer today, but the vault should not assume that forever.
            uint256 before = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(token).balanceOf(address(this)) - before;
            if (received == 0) revert ZeroAmount();

            uint256 updated = holdings[folioId][token] + received;
            if (updated > cfg.cap) revert AssetCapExceeded(token, updated, cfg.cap);
            holdings[folioId][token] = updated;

            if (!_tracked[folioId][token]) {
                if (_assetList[folioId].length >= MAX_ASSETS_PER_FOLIO) revert TooManyAssets();
                _tracked[folioId][token] = true;
                _assetList[folioId].push(token);
            }

            emit FolioFunded(folioId, msg.sender, token, received);
        }
    }

    function _authorizeWithdraw(uint256 folioId, address to) private view {
        if (to == address(0)) revert InvalidRecipient();
        if (_requireOwned(folioId) != msg.sender) revert NotFolioOwner();
        uint64 unlockAt = _folios[folioId].unlockAt;
        if (block.timestamp < unlockAt) revert FolioLocked(unlockAt);
    }

    function _payOut(uint256 folioId, address token, uint256 amount, address to) private {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = holdings[folioId][token];
        if (amount > bal) revert NothingToWithdraw();
        holdings[folioId][token] = bal - amount;
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(folioId, to, token, amount);
    }

    // ---------------------------------------------------------------- views

    function getFolio(uint256 folioId) external view returns (Folio memory folio, address owner, bool escrowed) {
        owner = _requireOwned(folioId);
        folio = _folios[folioId];
        escrowed = owner == address(this);
    }

    function getHoldings(uint256 folioId) external view returns (address[] memory tokens, uint256[] memory amounts) {
        address[] storage list = _assetList[folioId];
        tokens = new address[](list.length);
        amounts = new uint256[](list.length);
        for (uint256 i; i < list.length; ++i) {
            tokens[i] = list[i];
            amounts[i] = holdings[folioId][list[i]];
        }
    }

    function isUnlocked(uint256 folioId) external view returns (bool) {
        return block.timestamp >= _folios[folioId].unlockAt;
    }

    /// @notice Folios held for a claim link have no owner yet; surface them by hash.
    function isClaimable(uint256 folioId) external view returns (bool) {
        return _ownerOf(folioId) == address(this) && _folios[folioId].claimHash != bytes32(0);
    }
}
