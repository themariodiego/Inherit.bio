/** Compatibility names for Copilot's existing bounded prepared reader.
 * Its dispatcher still owns Copilot permission, complete-projection checks
 * and the transactional history commit; the neutral reader grants nothing. */
export {
  readOwnPreparedRsidCalls as readOwnPreparedCopilotCalls,
  PreparedRsidReadError as PreparedCopilotReadError,
  type PreparedRsidSelection as PreparedCopilotSelection,
  type OwnPreparedRsidCall as OwnPreparedCopilotCall,
} from "../genome/prepared-source/selected-rsid-calls";
