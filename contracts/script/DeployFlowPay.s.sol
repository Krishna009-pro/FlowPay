// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FlowPay} from "../src/FlowPay.sol";

interface VmBroadcast {
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface FoundryConsole {
    function log(string calldata message, address value) external;
}

contract DeployFlowPay {
    VmBroadcast private constant vm = VmBroadcast(address(uint160(uint256(keccak256("hevm cheat code")))));
    FoundryConsole private constant console = FoundryConsole(0x000000000000000000636f6e736f6c652e6c6f67);

    function run() external returns (FlowPay flowPay) {
        require(block.chainid == 10_143, "Deploy only to Monad Testnet");

        vm.startBroadcast();
        flowPay = new FlowPay();
        vm.stopBroadcast();

        console.log("FlowPay contract", address(flowPay));
        console.log("FlowPay employer", flowPay.employer());
    }
}
