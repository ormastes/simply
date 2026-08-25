export function printUsage() {
  console.log(`Usage: spipe <command> [args]

Commands:
  info                 Print module paths and available surfaces.
  experts              List project, tool, and domain experts.
  link-plan [host]     Show host links that setup will manage.
  doc-root [host]      Print configured host process-doc root.
  doc-link [host] [doc-root]
                       Create or update host .spipe/doc link.
  doctor [host]        Check module files and host link status.
  skill                Print the SPipe skill guide.
  fine-tune-guide      Print the LLM fine-tune process guide.
  fine-tune-model-guide
                       Print the LLM base-model research guide.
  fine-tune-template   Print the LLM fine-tune attempt template.
  fine-tune-init       Initialize host fine-tune state directories and registries.
  fine-tune-new-attempt <attempt_id> <goal> [target]
                       Create a host attempt record from the template.
  fine-tune-record-data <attempt_id> <name> <source> <license> <download_command> <cache_path> [checksum]
                       Append data-download evidence for an attempt.
  fine-tune-data-plan <attempt_id>
                       Print recorded data downloads and verification checks.
  fine-tune-record-data-check <attempt_id> <name> <cache_path> <result> [checksum] [notes]
                       Append data cache/checksum verification evidence.
  fine-tune-record-model <attempt_id> <base_model> <revision> <reason> <deployment_target>
                       Append base-model selection evidence for an attempt.
  fine-tune-record-model-research <attempt_id> <candidate_model> <license> <context_length> <fit> <constraints> <decision>
                       Append candidate model research evidence.
  fine-tune-record-model-arch <attempt_id> <architecture_doc> <model_family> <data_strategy> <training_strategy> <deployment_target> <fallback>
                       Append new-model architecture evidence.
  fine-tune-scaffold-model-arch <attempt_id> <architecture_doc> <model_family> <data_strategy> <training_strategy> <deployment_target> <fallback>
                       Write a new-model architecture doc scaffold and record it.
  fine-tune-record-method <attempt_id> <method> <reason> <fallback> <selected_by>
                       Append tuning-method selection evidence.
  fine-tune-model-method-options <attempt_id>
                       List researched model candidates and supported tuning methods.
  fine-tune-select-model-method <attempt_id> <base_model> <revision> <deployment_target> <method> <selected_by> <fallback> [reason]
                       Record base-model and tuning-method design choices.
  fine-tune-record-training <attempt_id> <method> <training_script> <training_command> <model_artifact>
                       Append tuning/training evidence for an attempt.
  fine-tune-scaffold-training <attempt_id> <method> <script_path> [model_artifact]
                       Write an executable training-script scaffold and record it.
  fine-tune-record-eval <attempt_id> <eval_command> <metrics> <target> <result>
                       Append evaluation evidence for an attempt.
  fine-tune-record-decision <attempt_id> <status> <retry_target> [next_attempt] [notes]
                       Append verify-loop decision evidence for an attempt.
  fine-tune-record-verify-loop <attempt_id> <eval_command> <metrics> <target> <result> <status> <retry_target> [next_attempt] [notes]
                       Append eval+decision evidence and optionally create retry attempt.
  fine-tune-record-process <attempt_id> <research_doc> <requirements_doc> <nfr_doc> <plan_doc> <architecture_doc> <design_doc>
                       Append pipeline document trace for an attempt.
  fine-tune-scaffold-process-docs <attempt_id> <feature_slug> [title]
                       Write research/requirements/plan/design doc scaffolds and record them.
  fine-tune-record-requirements <attempt_id> <feature_option> <nfr_option> <selected_by> <selection_doc> [notes]
                       Append requirement option selection evidence.
  fine-tune-options    List host fine-tune requirement options.
  fine-tune-select-requirements <attempt_id> <feature_option> <nfr_option> <selected_by> [notes]
                       Write final requirement docs and record selected options.
  fine-tune-record-app <attempt_id> <app_target> <usage> <handoff_doc> <license_constraints> <safety_eval> <deployment_evidence>
                       Append LLM-backed app/server handoff evidence.
  fine-tune-record-retune <attempt_id> <reason> <source_eval> <next_attempt> <retry_target>
                       Append retune request evidence from verification.
  fine-tune-create-retry <source_attempt_id> <next_attempt_id> [goal] [target]
                       Create a retry attempt from a failed verification decision.
  fine-tune-app-handoff <attempt_id>
                       Print LLM-backed app/server handoff and retune evidence.
  fine-tune-status <attempt_id>
                       Report attempt evidence across host registries.
  fine-tune-doctor <attempt_id>
                       Check attempt evidence quality, placeholders, and next action.
  fine-tune-ready <attempt_id>
                       Fail unless an attempt is ready for real training/use.
  fine-tune-next <attempt_id>
                       Print the next fine-tune phase required by readiness.
  fine-tune-report <attempt_id>
                       Print a consolidated attempt evidence report.
  fine-tune-verify <record.sdn>
                       Verify required fields in an attempt record.
`);
}
