// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDC} from "../src/tokens/MockUSDC.sol";
import {CLP} from "../src/tokens/CLP.sol";
import {CPERP} from "../src/tokens/CPERP.sol";
import {Oracle} from "../src/core/Oracle.sol";
import {Pool} from "../src/core/Pool.sol";
import {Custody} from "../src/core/Custody.sol";
import {Trading} from "../src/core/Trading.sol";
import {P2PTrading} from "../src/core/P2PTrading.sol";
import {VAMM} from "../src/core/VAMM.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {MarketState} from "../src/core/MarketState.sol";
import {Governance} from "../src/governance/Governance.sol";

/// @title DeployLocal
/// @notice Deploys the full CTC-Perps stack to Anvil
contract DeployLocal is Script {
    // Feed IDs
    uint16 constant GOLD = 2056;
    uint16 constant SILVER = 2069;
    uint16 constant CRUDE_OIL = 2003;
    uint16 constant PLATINUM = 2062;

    // VAMM depths (virtual depth in USD, 18 decimals)
    uint256 constant GOLD_DEPTH = 13_000_000e18;
    uint256 constant SILVER_DEPTH = 5_000_000e18;
    uint256 constant CRUDE_OIL_DEPTH = 2_000_000e18;
    uint256 constant PLATINUM_DEPTH = 3_000_000e18;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address oracleSigner = vm.envAddress("ORACLE_SIGNER");

        vm.startBroadcast(deployerKey);

        // 1. Tokens
        MockUSDC usdc = new MockUSDC();
        CPERP cperp = new CPERP(deployer);

        CLP clpImpl = new CLP();
        CLP clp = CLP(address(new ERC1967Proxy(
            address(clpImpl),
            abi.encodeCall(CLP.initialize, (deployer))
        )));

        console.log("MockUSDC:", address(usdc));
        console.log("CLP:", address(clp));
        console.log("CPERP:", address(cperp));

        // 2. Oracle
        uint16[] memory feedIds = new uint16[](4);
        feedIds[0] = GOLD; feedIds[1] = SILVER; feedIds[2] = CRUDE_OIL; feedIds[3] = PLATINUM;

        Oracle oracleImpl = new Oracle();
        Oracle oracle = Oracle(address(new ERC1967Proxy(
            address(oracleImpl),
            abi.encodeCall(Oracle.initialize, (deployer, oracleSigner, 210, feedIds))
        )));
        console.log("Oracle:", address(oracle));

        // 3. Pool
        Pool poolImpl = new Pool();
        Pool pool = Pool(address(new ERC1967Proxy(
            address(poolImpl),
            abi.encodeCall(Pool.initialize, (deployer, address(usdc), address(clp), deployer, 9000))
        )));
        clp.transferOwnership(address(pool));
        console.log("Pool:", address(pool));

        // 4. FeeManager
        FeeManager fmImpl = new FeeManager();
        FeeManager feeManager = FeeManager(address(new ERC1967Proxy(
            address(fmImpl),
            abi.encodeCall(FeeManager.initialize, (deployer, 10, 500, 1, 9000))
        )));
        console.log("FeeManager:", address(feeManager));

        // 5. MarketState
        MarketState msImpl = new MarketState();
        MarketState marketState = MarketState(address(new ERC1967Proxy(
            address(msImpl),
            abi.encodeCall(MarketState.initialize, (deployer, address(oracle)))
        )));
        marketState.registerFeed(GOLD);
        marketState.registerFeed(SILVER);
        marketState.registerFeed(CRUDE_OIL);
        marketState.registerFeed(PLATINUM);
        console.log("MarketState:", address(marketState));

        // 6. Custodies
        address goldCustody = _deployCustody(deployer, GOLD, address(usdc), address(pool));
        address silverCustody = _deployCustody(deployer, SILVER, address(usdc), address(pool));
        address crudeOilCustody = _deployCustody(deployer, CRUDE_OIL, address(usdc), address(pool));
        address platinumCustody = _deployCustody(deployer, PLATINUM, address(usdc), address(pool));

        pool.addCustody(goldCustody, 2500);
        pool.addCustody(silverCustody, 2500);
        pool.addCustody(crudeOilCustody, 2500);
        pool.addCustody(platinumCustody, 2500);

        console.log("Custody Gold:", goldCustody);
        console.log("Custody Silver:", silverCustody);
        console.log("Custody CrudeOil:", crudeOilCustody);
        console.log("Custody Platinum:", platinumCustody);

        // 7. Trading
        Trading tradingImpl = new Trading();
        Trading trading = Trading(address(new ERC1967Proxy(
            address(tradingImpl),
            abi.encodeCall(Trading.initialize, (
                deployer, address(usdc), address(oracle), address(pool),
                address(feeManager), address(marketState),
                100e18, 3000, 10e18, 400
            ))
        )));
        trading.setFeedCustody(GOLD, goldCustody);
        trading.setFeedCustody(SILVER, silverCustody);
        trading.setFeedCustody(CRUDE_OIL, crudeOilCustody);
        trading.setFeedCustody(PLATINUM, platinumCustody);
        pool.setTrading(address(trading));
        Custody(goldCustody).setTrading(address(trading));
        Custody(silverCustody).setTrading(address(trading));
        Custody(crudeOilCustody).setTrading(address(trading));
        Custody(platinumCustody).setTrading(address(trading));
        console.log("Trading:", address(trading));

        // 8. VAMM
        VAMM vammImpl = new VAMM();
        VAMM vamm = VAMM(address(new ERC1967Proxy(
            address(vammImpl),
            abi.encodeCall(VAMM.initialize, (deployer))
        )));
        vamm.setDepthMultiplier(GOLD, GOLD_DEPTH);
        vamm.setDepthMultiplier(SILVER, SILVER_DEPTH);
        vamm.setDepthMultiplier(CRUDE_OIL, CRUDE_OIL_DEPTH);
        vamm.setDepthMultiplier(PLATINUM, PLATINUM_DEPTH);
        vamm.setMarketState(address(marketState));
        console.log("VAMM:", address(vamm));

        // 9. P2PTrading
        P2PTrading p2pImpl = new P2PTrading();
        P2PTrading p2pTrading = P2PTrading(address(new ERC1967Proxy(
            address(p2pImpl),
            abi.encodeCall(P2PTrading.initialize, (
                deployer, address(usdc), address(vamm), address(pool),
                address(marketState), address(feeManager),
                100e18, 10e18, 120
            ))
        )));
        vamm.setP2PTrading(address(p2pTrading));
        pool.setP2PTrading(address(p2pTrading));
        p2pTrading.setSettlementKeeper(oracleSigner);
        Custody(goldCustody).setP2PTrading(address(p2pTrading));
        Custody(silverCustody).setP2PTrading(address(p2pTrading));
        Custody(crudeOilCustody).setP2PTrading(address(p2pTrading));
        Custody(platinumCustody).setP2PTrading(address(p2pTrading));
        console.log("P2PTrading:", address(p2pTrading));

        // 10. Governance
        Governance govImpl = new Governance();
        Governance governance = Governance(address(new ERC1967Proxy(
            address(govImpl),
            abi.encodeCall(Governance.initialize, (deployer, address(cperp), 2000, 5100, 48 hours))
        )));
        console.log("Governance:", address(governance));

        // 11. Mint test USDC to deployer
        usdc.mint(deployer, 10_000_000e18);

        // 12. Transfer ownership of all contracts to Governance
        // After this, all onlyOwner functions (parameter changes, upgrades,
        // pause/unpause) can ONLY be called via a passed DAO proposal.
        // The oracle signer wallet only has: trustedSigner signature authority
        // (Oracle.updatePrices) and settlementKeeper role (P2PTrading.settleP2PBatch).
        oracle.transferOwnership(address(governance));
        pool.transferOwnership(address(governance));
        trading.transferOwnership(address(governance));
        p2pTrading.transferOwnership(address(governance));
        vamm.transferOwnership(address(governance));
        feeManager.transferOwnership(address(governance));
        marketState.transferOwnership(address(governance));
        Custody(goldCustody).transferOwnership(address(governance));
        Custody(silverCustody).transferOwnership(address(governance));
        Custody(crudeOilCustody).transferOwnership(address(governance));
        Custody(platinumCustody).transferOwnership(address(governance));

        vm.stopBroadcast();

        console.log("--- Deployment Complete ---");
        console.log("All contract ownership transferred to Governance:", address(governance));
    }

    function _deployCustody(
        address owner,
        uint16 feedId,
        address usdc,
        address pool
    ) internal returns (address) {
        Custody impl = new Custody();
        return address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Custody.initialize, (owner, feedId, usdc, pool, 500, 1))
        ));
    }
}
