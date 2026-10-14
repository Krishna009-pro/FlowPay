// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FlowPayStream} from "./FlowPayStream.sol";

interface IFlowPayStreamRegistryView {
    function employer() external view returns (address);
    function employee() external view returns (address);
    function streamCreated() external view returns (bool);
}

/// @notice Creates separate FlowPayStream contracts and indexes them by employer and employee.
/// @dev Stream funding is forwarded directly to each child contract; the factory never holds payroll funds.
contract FlowPayFactory {
    error InvalidEmployee();
    error InvalidStream();
    error AlreadyRegistered();
    error NotStreamEmployer();
    error InvalidLegacyStream();

    mapping(address => address[]) private employerStreams;
    mapping(address => address[]) private employeeStreams;
    mapping(address => bool) public isRegistered;

    event StreamCreatedByFactory(address indexed employer, address indexed employee, address indexed stream);
    event ExistingStreamRegistered(address indexed employer, address indexed employee, address indexed stream);

    function createStream(address employee, uint256 ratePerSecond) external payable returns (address stream) {
        if (employee == address(0) || employee == msg.sender) revert InvalidEmployee();
        FlowPayStream child = new FlowPayStream{value: msg.value}(msg.sender, employee, ratePerSecond);
        stream = address(child);
        _register(msg.sender, employee, stream);
        emit StreamCreatedByFactory(msg.sender, employee, stream);
    }

    function registerExistingStream(address stream) external {
        if (stream.code.length == 0) revert InvalidStream();
        if (isRegistered[stream]) revert AlreadyRegistered();

        IFlowPayStreamRegistryView candidate = IFlowPayStreamRegistryView(stream);
        address streamEmployer = candidate.employer();
        address streamEmployee = candidate.employee();
        bool created = candidate.streamCreated();

        if (streamEmployer != msg.sender) revert NotStreamEmployer();
        if (!created || streamEmployee == address(0) || streamEmployee == streamEmployer) revert InvalidLegacyStream();

        _register(streamEmployer, streamEmployee, stream);
        emit ExistingStreamRegistered(streamEmployer, streamEmployee, stream);
    }

    function getEmployerStreams(address employer) external view returns (address[] memory) {
        return employerStreams[employer];
    }

    function getEmployeeStreams(address employee) external view returns (address[] memory) {
        return employeeStreams[employee];
    }

    function _register(address employer, address employee, address stream) private {
        if (isRegistered[stream]) revert AlreadyRegistered();
        isRegistered[stream] = true;
        employerStreams[employer].push(stream);
        employeeStreams[employee].push(stream);
    }
}
