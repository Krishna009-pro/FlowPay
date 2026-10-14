// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FlowPayCore} from "./FlowPayCore.sol";

/// @notice Backward-compatible single-stream deployment used by the original Testnet demo.
contract FlowPay is FlowPayCore {
    constructor() FlowPayCore(msg.sender) {}
}
