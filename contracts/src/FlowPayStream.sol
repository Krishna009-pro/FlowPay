// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FlowPayCore} from "./FlowPayCore.sol";

/// @notice One independently funded salary stream created by FlowPayFactory.
contract FlowPayStream is FlowPayCore {
    constructor(address employer_, address employee_, uint256 ratePerSecond_)
        payable
        FlowPayCore(employer_)
    {
        _createStream(employee_, ratePerSecond_, msg.value);
    }
}
