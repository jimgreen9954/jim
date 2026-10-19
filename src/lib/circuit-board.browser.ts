import { loadCircuitBoard } from "./circuit-board.server";

export type { CircuitBar, CircuitBoard, CircuitPrint, CircuitRow, CircuitSigned } from "./circuit-board";

export function getCircuitBoard(input?: { data?: { account?: string } }) {
  return loadCircuitBoard(input?.data?.account ?? "");
}
