/**
 * Shared vocabulary for the flow gates.
 *
 * A gate is a pure function of artifacts on disk: it reads the files a stage
 * must produce, checks the invariants that hold regardless of project, and
 * reports typed findings. It never asks a model what it thinks, and it never
 * writes — adjudication stays with the main agent, which reads the findings and
 * decides where to send the work back.
 *
 * @module dsh-fullstack-team/gates/types
 */

/** The flow stages, in order. */
export const STAGES = ['clarify', 'design', 'build', 'test', 'accept', 'ship'] as const

/** One flow stage. */
export type Stage = (typeof STAGES)[number]

/** Stages that a gate can judge. The others only carry state. */
export const GATED_STAGES = ['clarify', 'design', 'test', 'accept'] as const

/** A stage a gate can judge. */
export type GatedStage = (typeof GATED_STAGES)[number]

/** How much a finding blocks progress. */
export type Severity = 'error' | 'warning'

/** One blocking or advisory finding. */
export interface Finding {
  /** Stable machine code, e.g. `FP_UNCOVERED`. */
  code: string
  /** Whether the finding blocks the stage. */
  severity: Severity
  /** One line a person can act on. */
  detail: string
  /** Artifact the finding belongs to, relative to the gate root. */
  path?: string
  /** 1-based line, when the finding is line-specific. */
  line?: number
}

/** The verdict of one gate run. */
export interface GateResult {
  stage: GatedStage
  /** True when no `error` finding was produced. */
  pass: boolean
  findings: Finding[]
  /** Artifacts that were read, relative to the gate root. */
  checked: string[]
}

/** Whether a gate can judge `stage`. */
export function isGatedStage(stage: Stage): stage is GatedStage {
  return (GATED_STAGES as readonly string[]).includes(stage)
}

/** Build one finding. */
export function finding(
  code: string,
  detail: string,
  extra: { severity?: Severity; path?: string; line?: number } = {},
): Finding {
  return {
    code,
    severity: extra.severity ?? 'error',
    detail,
    ...(extra.path === undefined ? {} : { path: extra.path }),
    ...(extra.line === undefined ? {} : { line: extra.line }),
  }
}
