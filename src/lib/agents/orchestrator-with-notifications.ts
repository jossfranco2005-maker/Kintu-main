// Envoltorio conservado para mantener estable el contrato de importación del
// chat. Las notificaciones financieras ya no se crean antes de confirmar un
// borrador: ahora nacen de efectos deterministas después de persistir un
// movimiento y el trigger de `alerts` las lleva a la bandeja del usuario.
import {
  runOrchestrator as runOrchestratorBase,
  type OrchestratorInput,
  type OrchestratorResult,
} from "@/lib/agents/orchestrator";

export type { OrchestratorInput, OrchestratorResult };

export async function runOrchestrator(
  input: OrchestratorInput,
  stepsUsed = 0,
): Promise<OrchestratorResult> {
  return runOrchestratorBase(input, stepsUsed);
}

export { saveConfirmedTransaction } from "@/lib/agents/orchestrator";
