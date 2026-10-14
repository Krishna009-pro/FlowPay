// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FlowPay} from "../src/FlowPay.sol";
import {FlowPayCore} from "../src/FlowPayCore.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function deal(address account, uint256 newBalance) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
}

contract FlowPayTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FlowPay private flowPay;
    address private employee = address(0xBEEF);
    address private outsider = address(0xCAFE);

    function setUp() public {
        vm.deal(address(this), 100 ether);
        vm.deal(outsider, 10 ether);
        flowPay = new FlowPay();
    }

    function testEmployerCreatesOneFundedStreamWithTenPercentSavings() public {
        _createStream(20 ether, 1 ether);
        FlowPay.Snapshot memory snapshot = flowPay.getSnapshot();
        require(snapshot.employee == employee, "employee mismatch");
        require(snapshot.totalDeposited == 20 ether, "deposit mismatch");
        require(snapshot.savingsRateBps == 1_000, "default savings rate mismatch");
        require(snapshot.streamCreated, "stream should be created");
    }

    function testOnlyEmployerCanCreateAndInvalidInputsRevert() public {
        vm.expectRevert(FlowPayCore.Unauthorized.selector);
        vm.prank(outsider);
        flowPay.createStream{value: 2 ether}(employee, 1 ether);

        vm.expectRevert(FlowPayCore.InvalidEmployee.selector);
        flowPay.createStream{value: 2 ether}(address(this), 1 ether);

        vm.expectRevert(FlowPayCore.InvalidRate.selector);
        flowPay.createStream{value: 2 ether}(employee, 0);

        vm.expectRevert(FlowPayCore.InvalidDeposit.selector);
        flowPay.createStream(employee, 1 ether);

        _createStream(2 ether, 1 ether);
        vm.expectRevert(FlowPayCore.StreamAlreadyCreated.selector);
        flowPay.createStream{value: 2 ether}(employee, 1 ether);
    }

    function testVestingStopsAtDepositedFunds() public {
        _createStream(1 ether, 1 ether);
        vm.warp(block.timestamp + 3);
        FlowPay.Snapshot memory snapshot = flowPay.getSnapshot();
        require(snapshot.totalVested == 1 ether, "vesting exceeded funding");
        require(snapshot.availableToVest == 0, "funding should be exhausted");
        require(snapshot.underfunded, "stream should report underfunded");
    }

    function testPauseFreezesAccrualAndResumeRestartsAtCheckpoint() public {
        _createStream(20 ether, 1 ether);
        vm.warp(block.timestamp + 4);
        flowPay.pause();
        FlowPay.Snapshot memory atPause = flowPay.getSnapshot();

        vm.warp(block.timestamp + 8);
        FlowPay.Snapshot memory whilePaused = flowPay.getSnapshot();
        require(whilePaused.totalVested == atPause.totalVested, "paused stream accrued");

        flowPay.resume();
        FlowPay.Snapshot memory atResume = flowPay.getSnapshot();
        vm.warp(block.timestamp + 3);
        FlowPay.Snapshot memory afterResume = flowPay.getSnapshot();
        require(afterResume.totalVested - atResume.totalVested == 3 ether, "resume checkpoint mismatch");
    }

    function testTopUpRestartsExhaustedStreamWithoutRetroactiveVesting() public {
        _createStream(2 ether, 1 ether);
        vm.warp(block.timestamp + 5);
        require(flowPay.getSnapshot().totalVested == 2 ether, "initial funding cap mismatch");

        flowPay.topUp{value: 3 ether}();
        require(flowPay.getSnapshot().totalVested == 2 ether, "unfunded interval vested retroactively");
        vm.warp(block.timestamp + 2);
        require(flowPay.getSnapshot().totalVested == 4 ether, "top-up did not resume vesting");
    }

    function testEmployeeClaimsAreRoleRestrictedAndIndependent() public {
        _createStream(20 ether, 1 ether);
        vm.warp(block.timestamp + 10);

        vm.expectRevert(FlowPayCore.Unauthorized.selector);
        vm.prank(outsider);
        flowPay.claimSalary(1 ether);

        vm.expectRevert(FlowPayCore.InvalidClaimAmount.selector);
        vm.prank(employee);
        flowPay.claimSalary(100 ether);

        uint256 employeeBalanceBefore = employee.balance;
        vm.prank(employee);
        flowPay.claimSalary(2 ether);
        vm.prank(employee);
        flowPay.claimSavings(1 ether);
        require(employee.balance == employeeBalanceBefore + 3 ether, "claims not transferred");

        FlowPay.Snapshot memory snapshot = flowPay.getSnapshot();
        require(snapshot.salaryClaimed == 2 ether, "salary claim mismatch");
        require(snapshot.savingsClaimed == 1 ether, "savings claim mismatch");
    }

    function testSavingsRateCheckpointsAndPreservesFractionalRemainder() public {
        _createStream(100, 1);
        vm.prank(employee);
        flowPay.setSavingsRate(3_000);
        vm.warp(block.timestamp + 1);
        vm.prank(employee);
        flowPay.setSavingsRate(0);

        FlowPay.Snapshot memory snapshot = flowPay.getSnapshot();
        require(snapshot.totalVested == 1, "old-rate accrual was not checkpointed");
        require(snapshot.savingsRemainder == 3_000, "fractional remainder was lost");

        vm.warp(block.timestamp + 1);
        vm.prank(employee);
        flowPay.setSavingsRate(3_000);
        snapshot = flowPay.getSnapshot();
        require(snapshot.totalVested == 2, "future vesting checkpoint mismatch");
        require(snapshot.savingsAccrued == 0, "fractional savings unexpectedly rounded up");
        require(snapshot.savingsRemainder == 3_000, "remainder changed at zero rate");
    }

    function testSavingsRateRejectsValuesOutsideFivePercentSteps() public {
        _createStream(2 ether, 1 ether);
        vm.expectRevert(FlowPayCore.InvalidSavingsRate.selector);
        vm.prank(employee);
        flowPay.setSavingsRate(1_000 + 1);

        vm.expectRevert(FlowPayCore.InvalidSavingsRate.selector);
        vm.prank(employee);
        flowPay.setSavingsRate(3_500);
    }

    function _createStream(uint256 funding, uint256 rate) private {
        flowPay.createStream{value: funding}(employee, rate);
    }
}
