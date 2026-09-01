export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      abuse_events: {
        Row: {
          audit_principal_id: string | null
          bucket_key_hmac: string | null
          coded_context: Json
          event_code: string
          expires_at: string
          id: string
          occurred_at: string
          outcome_code: string
          route_id: string | null
        }
        Insert: {
          audit_principal_id?: string | null
          bucket_key_hmac?: string | null
          coded_context?: Json
          event_code: string
          expires_at: string
          id?: string
          occurred_at?: string
          outcome_code: string
          route_id?: string | null
        }
        Update: {
          audit_principal_id?: string | null
          bucket_key_hmac?: string | null
          coded_context?: Json
          event_code?: string
          expires_at?: string
          id?: string
          occurred_at?: string
          outcome_code?: string
          route_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abuse_events_audit_principal_id_fkey"
            columns: ["audit_principal_id"]
            isOneToOne: false
            referencedRelation: "audit_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          account_id: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          delete_started_at: string | null
          deletion_hold_revision: number
          id: string
          notice_ends_at: string
          principal_graph_revision: number
          request_account_revision: number
          request_auth_session_revision: number
          requested_at: string
          state: string
        }
        Insert: {
          account_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          delete_started_at?: string | null
          deletion_hold_revision: number
          id?: string
          notice_ends_at: string
          principal_graph_revision: number
          request_account_revision: number
          request_auth_session_revision: number
          requested_at: string
          state?: string
        }
        Update: {
          account_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          delete_started_at?: string | null
          deletion_hold_revision?: number
          id?: string
          notice_ends_at?: string
          principal_graph_revision?: number
          request_account_revision?: number
          request_auth_session_revision?: number
          requested_at?: string
          state?: string
        }
        Relationships: []
      }
      account_operation_nonces: {
        Row: {
          account_id: string
          consumed_at: string | null
          expires_at: string
          issued_at: string
          nonce_hash: string
          operation: string
          session_id: string
        }
        Insert: {
          account_id: string
          consumed_at?: string | null
          expires_at: string
          issued_at?: string
          nonce_hash: string
          operation: string
          session_id: string
        }
        Update: {
          account_id?: string
          consumed_at?: string | null
          expires_at?: string
          issued_at?: string
          nonce_hash?: string
          operation?: string
          session_id?: string
        }
        Relationships: []
      }
      account_security_states: {
        Row: {
          account_id: string
          active_contradiction_count: number
          failed_reauth_count: number
          locked_until: string | null
          non_self_upload_suspended_at: string | null
          security_revision: number
          updated_at: string
        }
        Insert: {
          account_id: string
          active_contradiction_count?: number
          failed_reauth_count?: number
          locked_until?: string | null
          non_self_upload_suspended_at?: string | null
          security_revision?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          active_contradiction_count?: number
          failed_reauth_count?: number
          locked_until?: string | null
          non_self_upload_suspended_at?: string | null
          security_revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      adult_subject_drafts: {
        Row: {
          created_at: string
          draft_revision: number
          fixed_expires_at: string
          id: string
          owner_account_id: string
          state: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          draft_revision: number
          fixed_expires_at: string
          id?: string
          owner_account_id: string
          state?: string
          subject_id: string
        }
        Update: {
          created_at?: string
          draft_revision?: number
          fixed_expires_at?: string
          id?: string
          owner_account_id?: string
          state?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adult_subject_drafts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: true
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_jobs: {
        Row: {
          authorization_fingerprint: string
          created_at: string
          id: string
          state: string
          worker_job_id: string
        }
        Insert: {
          authorization_fingerprint: string
          created_at?: string
          id?: string
          state: string
          worker_job_id: string
        }
        Update: {
          authorization_fingerprint?: string
          created_at?: string
          id?: string
          state?: string
          worker_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_worker_job_id_fkey"
            columns: ["worker_job_id"]
            isOneToOne: true
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ancestry_regions: {
        Row: {
          ancestry_result_id: string
          evidence_label: string
          markers_used: number
          method_version: string
          p05: number
          p95: number
          point: number
          region_code: string
          release_id: string
          subject_id: string
        }
        Insert: {
          ancestry_result_id: string
          evidence_label: string
          markers_used: number
          method_version: string
          p05: number
          p95: number
          point: number
          region_code: string
          release_id: string
          subject_id: string
        }
        Update: {
          ancestry_result_id?: string
          evidence_label?: string
          markers_used?: number
          method_version?: string
          p05?: number
          p95?: number
          point?: number
          region_code?: string
          release_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ancestry_regions_ancestry_result_id_fkey"
            columns: ["ancestry_result_id"]
            isOneToOne: false
            referencedRelation: "ancestry_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ancestry_regions_release_id_region_code_fkey"
            columns: ["release_id", "region_code"]
            isOneToOne: false
            referencedRelation: "ref_regions"
            referencedColumns: ["release_id", "region_code"]
          },
          {
            foreignKeyName: "ancestry_regions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      ancestry_results: {
        Row: {
          computation_revision: number
          coverage: number | null
          created_at: string
          file_id: string
          id: string
          kind: string
          model_id: string | null
          model_version: string | null
          not_covered_reason: string | null
          result: Json
          result_state: string
          source_binding_fingerprint: string | null
          subject_id: string
          support_note: string
          user_id: string
        }
        Insert: {
          computation_revision?: number
          coverage?: number | null
          created_at?: string
          file_id: string
          id?: string
          kind: string
          model_id?: string | null
          model_version?: string | null
          not_covered_reason?: string | null
          result: Json
          result_state?: string
          source_binding_fingerprint?: string | null
          subject_id: string
          support_note: string
          user_id: string
        }
        Update: {
          computation_revision?: number
          coverage?: number | null
          created_at?: string
          file_id?: string
          id?: string
          kind?: string
          model_id?: string | null
          model_version?: string | null
          not_covered_reason?: string | null
          result?: Json
          result_state?: string
          source_binding_fingerprint?: string | null
          subject_id?: string
          support_note?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ancestry_results_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ancestry_results_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      appeal_assignments: {
        Row: {
          appeal_id: string
          decided_at: string
          decision: string
          id: string
          reason_code: string
          review_revision: number
          reviewer_principal_id: string
        }
        Insert: {
          appeal_id: string
          decided_at?: string
          decision: string
          id?: string
          reason_code: string
          review_revision: number
          reviewer_principal_id: string
        }
        Update: {
          appeal_id?: string
          decided_at?: string
          decision?: string
          id?: string
          reason_code?: string
          review_revision?: number
          reviewer_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeal_assignments_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeal_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeal_assignments_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      appeal_evidence: {
        Row: {
          appeal_id: string
          evidence_kind: string
          evidence_revision: number
          id: string
          reviewed_evidence_id: string
        }
        Insert: {
          appeal_id: string
          evidence_kind: string
          evidence_revision: number
          id?: string
          reviewed_evidence_id: string
        }
        Update: {
          appeal_id?: string
          evidence_kind?: string
          evidence_revision?: number
          id?: string
          reviewed_evidence_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeal_evidence_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeal_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeal_evidence_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      appeal_intakes: {
        Row: {
          appeal_revision: number
          appellant_account_id: string | null
          appellant_principal_id: string
          decided_at: string | null
          id: string
          state: string
          statement_ciphertext: string
          submitted_at: string
          target_id: string
          target_kind: string
        }
        Insert: {
          appeal_revision: number
          appellant_account_id?: string | null
          appellant_principal_id: string
          decided_at?: string | null
          id?: string
          state?: string
          statement_ciphertext: string
          submitted_at?: string
          target_id: string
          target_kind: string
        }
        Update: {
          appeal_revision?: number
          appellant_account_id?: string | null
          appellant_principal_id?: string
          decided_at?: string | null
          id?: string
          state?: string
          statement_ciphertext?: string
          submitted_at?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeal_intakes_appellant_principal_id_fkey"
            columns: ["appellant_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      attestation_contradictions: {
        Row: {
          attestation_id: string | null
          cohort_id: string | null
          contradiction_code: string
          id: string
          lifecycle_revision: number
          principal_id: string
          recorded_at: string
          resolved_at: string | null
          subject_id: string | null
        }
        Insert: {
          attestation_id?: string | null
          cohort_id?: string | null
          contradiction_code: string
          id?: string
          lifecycle_revision: number
          principal_id: string
          recorded_at?: string
          resolved_at?: string | null
          subject_id?: string | null
        }
        Update: {
          attestation_id?: string | null
          cohort_id?: string | null
          contradiction_code?: string
          id?: string
          lifecycle_revision?: number
          principal_id?: string
          recorded_at?: string
          resolved_at?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attestation_contradictions_attestation_id_fkey"
            columns: ["attestation_id"]
            isOneToOne: false
            referencedRelation: "attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestation_contradictions_cohort_fk"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestation_contradictions_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestation_contradictions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      attestations: {
        Row: {
          affirmed: boolean
          affirmed_at: string
          attestation_revision: number
          id: string
          kind: string
          principal_id: string
          signature_id: string
          statement_keys: string[]
          target_id: string
          target_kind: string
        }
        Insert: {
          affirmed: boolean
          affirmed_at?: string
          attestation_revision?: number
          id?: string
          kind: string
          principal_id: string
          signature_id: string
          statement_keys: string[]
          target_id: string
          target_kind: string
        }
        Update: {
          affirmed?: boolean
          affirmed_at?: string
          attestation_revision?: number
          id?: string
          kind?: string
          principal_id?: string
          signature_id?: string
          statement_keys?: string[]
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "attestations_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "consent_signatures"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_principal_link_keys: {
        Row: {
          audit_principal_id: string
          created_at: string
          key_ciphertext: string | null
          key_revision: number
          shredded_at: string | null
        }
        Insert: {
          audit_principal_id: string
          created_at?: string
          key_ciphertext?: string | null
          key_revision: number
          shredded_at?: string | null
        }
        Update: {
          audit_principal_id?: string
          created_at?: string
          key_ciphertext?: string | null
          key_revision?: number
          shredded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_principal_link_keys_audit_principal_id_fkey"
            columns: ["audit_principal_id"]
            isOneToOne: true
            referencedRelation: "audit_principal_links"
            referencedColumns: ["audit_principal_id"]
          },
        ]
      }
      audit_principal_links: {
        Row: {
          account_ciphertext: string | null
          audit_principal_id: string
          crypto_shredded_at: string | null
          key_revision: number
          subject_ciphertext: string | null
        }
        Insert: {
          account_ciphertext?: string | null
          audit_principal_id: string
          crypto_shredded_at?: string | null
          key_revision: number
          subject_ciphertext?: string | null
        }
        Update: {
          account_ciphertext?: string | null
          audit_principal_id?: string
          crypto_shredded_at?: string | null
          key_revision?: number
          subject_ciphertext?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_principal_links_audit_principal_id_fkey"
            columns: ["audit_principal_id"]
            isOneToOne: true
            referencedRelation: "audit_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_principals: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      changelog_entries: {
        Row: {
          body: string
          id: string
          published_at: string
          template_slug: string | null
          title: string
        }
        Insert: {
          body: string
          id?: string
          published_at?: string
          template_slug?: string | null
          title: string
        }
        Update: {
          body?: string
          id?: string
          published_at?: string
          template_slug?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "changelog_entries_template_slug_fkey"
            columns: ["template_slug"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["slug"]
          },
        ]
      }
      chat_messages: {
        Row: {
          authorization_fingerprint: string
          chat_id: string
          citation_ids: string[]
          cohort_authority_fingerprint: string | null
          content: Json
          contributor_ids: string[]
          created_at: string
          embryo_findings: Json
          grant_revisions: number[]
          id: string
          legacy_unverified: boolean
          lifecycle_revisions: number[]
          model_recipient_revision: number
          paired_role: string
          provider_classification: string
          retrieved_purpose_keys: string[]
          retrieved_subject_ids: string[]
          role: string
          runtime_attestation_revision: number
          scope_revision: number
          turn_id: string
          turn_ordinal: number
          user_id: string
        }
        Insert: {
          authorization_fingerprint: string
          chat_id: string
          citation_ids?: string[]
          cohort_authority_fingerprint?: string | null
          content: Json
          contributor_ids?: string[]
          created_at?: string
          embryo_findings?: Json
          grant_revisions?: number[]
          id?: string
          legacy_unverified?: boolean
          lifecycle_revisions?: number[]
          model_recipient_revision: number
          paired_role: string
          provider_classification: string
          retrieved_purpose_keys?: string[]
          retrieved_subject_ids?: string[]
          role: string
          runtime_attestation_revision: number
          scope_revision: number
          turn_id: string
          turn_ordinal: number
          user_id: string
        }
        Update: {
          authorization_fingerprint?: string
          chat_id?: string
          citation_ids?: string[]
          cohort_authority_fingerprint?: string | null
          content?: Json
          contributor_ids?: string[]
          created_at?: string
          embryo_findings?: Json
          grant_revisions?: number[]
          id?: string
          legacy_unverified?: boolean
          lifecycle_revisions?: number[]
          model_recipient_revision?: number
          paired_role?: string
          provider_classification?: string
          retrieved_purpose_keys?: string[]
          retrieved_subject_ids?: string[]
          role?: string
          runtime_attestation_revision?: number
          scope_revision?: number
          turn_id?: string
          turn_ordinal?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          authorization_fingerprint: string
          cohort_authority_fingerprint: string | null
          cohort_id: string | null
          created_at: string
          family_pair_id: string | null
          grant_revision: number | null
          id: string
          legacy_unverified: boolean
          lifecycle_revision: number
          model_recipient_revision: number
          provider_classification: string
          relationship_revision: number | null
          report_id: string | null
          runtime_attestation_revision: number
          scope_kind: string
          scope_revision: number
          subject_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          authorization_fingerprint: string
          cohort_authority_fingerprint?: string | null
          cohort_id?: string | null
          created_at?: string
          family_pair_id?: string | null
          grant_revision?: number | null
          id?: string
          legacy_unverified?: boolean
          lifecycle_revision: number
          model_recipient_revision: number
          provider_classification: string
          relationship_revision?: number | null
          report_id?: string | null
          runtime_attestation_revision: number
          scope_kind: string
          scope_revision?: number
          subject_id?: string | null
          title?: string
          user_id: string
        }
        Update: {
          authorization_fingerprint?: string
          cohort_authority_fingerprint?: string | null
          cohort_id?: string | null
          created_at?: string
          family_pair_id?: string | null
          grant_revision?: number | null
          id?: string
          legacy_unverified?: boolean
          lifecycle_revision?: number
          model_recipient_revision?: number
          provider_classification?: string
          relationship_revision?: number | null
          report_id?: string | null
          runtime_attestation_revision?: number
          scope_kind?: string
          scope_revision?: number
          subject_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_family_pair_id_fkey"
            columns: ["family_pair_id"]
            isOneToOne: false
            referencedRelation: "family_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_model_calls: {
        Row: {
          call_revision: number
          completed_at: string | null
          created_at: string
          id: string
          model_context_id: string
          provider_recipient_grant_id: string
          provider_request_id_hmac: string | null
          status: string
        }
        Insert: {
          call_revision: number
          completed_at?: string | null
          created_at?: string
          id?: string
          model_context_id: string
          provider_recipient_grant_id: string
          provider_request_id_hmac?: string | null
          status: string
        }
        Update: {
          call_revision?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          model_context_id?: string
          provider_recipient_grant_id?: string
          provider_request_id_hmac?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_model_calls_model_context_id_fkey"
            columns: ["model_context_id"]
            isOneToOne: false
            referencedRelation: "model_contexts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_model_calls_provider_recipient_grant_id_fkey"
            columns: ["provider_recipient_grant_id"]
            isOneToOne: false
            referencedRelation: "provider_recipient_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_provider_attempts: {
        Row: {
          attempt_ordinal: number
          cloud_model_call_id: string
          completed_at: string | null
          id: string
          outcome_code: string | null
          started_at: string
        }
        Insert: {
          attempt_ordinal: number
          cloud_model_call_id: string
          completed_at?: string | null
          id?: string
          outcome_code?: string | null
          started_at?: string
        }
        Update: {
          attempt_ordinal?: number
          cloud_model_call_id?: string
          completed_at?: string | null
          id?: string
          outcome_code?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_provider_attempts_cloud_model_call_id_fkey"
            columns: ["cloud_model_call_id"]
            isOneToOne: false
            referencedRelation: "cloud_model_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_provider_payloads: {
        Row: {
          cloud_model_call_id: string
          created_at: string
          envelope_key_revision: number
          expires_at: string
          id: string
          payload_ciphertext: string
          payload_revision: number
          state: string
        }
        Insert: {
          cloud_model_call_id: string
          created_at?: string
          envelope_key_revision: number
          expires_at: string
          id?: string
          payload_ciphertext: string
          payload_revision: number
          state: string
        }
        Update: {
          cloud_model_call_id?: string
          created_at?: string
          envelope_key_revision?: number
          expires_at?: string
          id?: string
          payload_ciphertext?: string
          payload_revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_provider_payloads_cloud_model_call_id_fkey"
            columns: ["cloud_model_call_id"]
            isOneToOne: false
            referencedRelation: "cloud_model_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_registry: {
        Row: {
          active: boolean
          category: string
          citation_ids: string[]
          condition_id: string
          condition_name: string
          inheritance_mode: string | null
          phenotype_class: string
          registry_revision: number
        }
        Insert: {
          active?: boolean
          category: string
          citation_ids?: string[]
          condition_id: string
          condition_name: string
          inheritance_mode?: string | null
          phenotype_class: string
          registry_revision: number
        }
        Update: {
          active?: boolean
          category?: string
          citation_ids?: string[]
          condition_id?: string
          condition_name?: string
          inheritance_mode?: string | null
          phenotype_class?: string
          registry_revision?: number
        }
        Relationships: []
      }
      consent_artifacts: {
        Row: {
          artifact_key: string
          body_markdown: string
          body_sha256: string
          effective_on: string
          published_at: string
          summary_markdown: string
          summary_of_changes: string | null
          superseded_at: string | null
          version: number
        }
        Insert: {
          artifact_key: string
          body_markdown: string
          body_sha256: string
          effective_on: string
          published_at?: string
          summary_markdown: string
          summary_of_changes?: string | null
          superseded_at?: string | null
          version: number
        }
        Update: {
          artifact_key?: string
          body_markdown?: string
          body_sha256?: string
          effective_on?: string
          published_at?: string
          summary_markdown?: string
          summary_of_changes?: string | null
          superseded_at?: string | null
          version?: number
        }
        Relationships: []
      }
      consent_grants: {
        Row: {
          data_classes: string[]
          granted_at: string
          id: string
          provider_key: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          data_classes: string[]
          granted_at?: string
          id?: string
          provider_key: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          data_classes?: string[]
          granted_at?: string
          id?: string
          provider_key?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      consent_purposes: {
        Row: {
          active: boolean
          description: string
          purpose: string
        }
        Insert: {
          active?: boolean
          description: string
          purpose: string
        }
        Update: {
          active?: boolean
          description?: string
          purpose?: string
        }
        Relationships: []
      }
      consent_signatures: {
        Row: {
          artifact_body_sha256: string
          artifact_key: string
          artifact_version: number
          id: string
          jurisdiction_code: string
          jurisdiction_revision: number
          purpose: string | null
          signed_at: string
          signer_account_id: string | null
          signer_principal_id: string
          signing_name_encrypted: string | null
          statement_keys: string[]
          subject_binding_revision: number | null
          target_id: string
          target_kind: string
        }
        Insert: {
          artifact_body_sha256: string
          artifact_key: string
          artifact_version: number
          id?: string
          jurisdiction_code: string
          jurisdiction_revision: number
          purpose?: string | null
          signed_at?: string
          signer_account_id?: string | null
          signer_principal_id: string
          signing_name_encrypted?: string | null
          statement_keys?: string[]
          subject_binding_revision?: number | null
          target_id: string
          target_kind: string
        }
        Update: {
          artifact_body_sha256?: string
          artifact_key?: string
          artifact_version?: number
          id?: string
          jurisdiction_code?: string
          jurisdiction_revision?: number
          purpose?: string | null
          signed_at?: string
          signer_account_id?: string | null
          signer_principal_id?: string
          signing_name_encrypted?: string | null
          statement_keys?: string[]
          subject_binding_revision?: number | null
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_signatures_artifact_key_artifact_version_fkey"
            columns: ["artifact_key", "artifact_version"]
            isOneToOne: false
            referencedRelation: "consent_artifacts"
            referencedColumns: ["artifact_key", "version"]
          },
          {
            foreignKeyName: "consent_signatures_signer_principal_id_fkey"
            columns: ["signer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_hmac_indexes: {
        Row: {
          contact_hmac: string
          contact_reference_id: string
          expires_at: string
          hmac_key_revision: number
          status: string
        }
        Insert: {
          contact_hmac: string
          contact_reference_id: string
          expires_at: string
          hmac_key_revision: number
          status?: string
        }
        Update: {
          contact_hmac?: string
          contact_reference_id?: string
          expires_at?: string
          hmac_key_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_hmac_indexes_contact_reference_id_fkey"
            columns: ["contact_reference_id"]
            isOneToOne: false
            referencedRelation: "encrypted_contact_references"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_refusal_bars: {
        Row: {
          contact_hmac: string
          created_at: string
          expires_at: string
          id: string
          refusal_revision: number
          target_id: string
          target_kind: string
        }
        Insert: {
          contact_hmac: string
          created_at?: string
          expires_at: string
          id?: string
          refusal_revision: number
          target_id: string
          target_kind: string
        }
        Update: {
          contact_hmac?: string
          created_at?: string
          expires_at?: string
          id?: string
          refusal_revision?: number
          target_id?: string
          target_kind?: string
        }
        Relationships: []
      }
      copilot_context_history: {
        Row: {
          authorization_fingerprint: string
          chat_id: string
          context_revision: number
          created_at: string
          id: string
          retrieved_purpose_keys: string[]
          retrieved_subject_ids: string[]
          scope_revision: number
          turn_id: string
        }
        Insert: {
          authorization_fingerprint: string
          chat_id: string
          context_revision: number
          created_at?: string
          id?: string
          retrieved_purpose_keys?: string[]
          retrieved_subject_ids?: string[]
          scope_revision: number
          turn_id: string
        }
        Update: {
          authorization_fingerprint?: string
          chat_id?: string
          context_revision?: number
          created_at?: string
          id?: string
          retrieved_purpose_keys?: string[]
          retrieved_subject_ids?: string[]
          scope_revision?: number
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_context_history_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_context_tokens: {
        Row: {
          account_id: string
          authorization_fingerprint: string
          chat_id: string | null
          created_at: string
          expires_at: string
          id: string
          issuing_route_id: string
          nonce_hash: string
          redeemed_at: string | null
          scope_kind: string
          target_id: string
          token_revision: number
        }
        Insert: {
          account_id: string
          authorization_fingerprint: string
          chat_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issuing_route_id: string
          nonce_hash: string
          redeemed_at?: string | null
          scope_kind: string
          target_id: string
          token_revision: number
        }
        Update: {
          account_id?: string
          authorization_fingerprint?: string
          chat_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issuing_route_id?: string
          nonce_hash?: string
          redeemed_at?: string | null
          scope_kind?: string
          target_id?: string
          token_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "copilot_context_tokens_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_generation_sessions: {
        Row: {
          account_id: string
          authorization_fingerprint: string
          chat_id: string | null
          created_at: string
          expires_at: string
          id: string
          scope_revision: number
          state: string
        }
        Insert: {
          account_id: string
          authorization_fingerprint: string
          chat_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          scope_revision: number
          state: string
        }
        Update: {
          account_id?: string
          authorization_fingerprint?: string
          chat_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          scope_revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_generation_sessions_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_turn_dependencies: {
        Row: {
          chat_id: string
          dependency_id: string
          dependency_kind: string
          dependency_revision: number
          source_binding_fingerprint: string
          turn_id: string
        }
        Insert: {
          chat_id: string
          dependency_id: string
          dependency_kind: string
          dependency_revision: number
          source_binding_fingerprint: string
          turn_id: string
        }
        Update: {
          chat_id?: string
          dependency_id?: string
          dependency_kind?: string
          dependency_revision?: number
          source_binding_fingerprint?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_turn_dependencies_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_assignments: {
        Row: {
          correction_id: string
          decided_at: string
          decision: string
          id: string
          reason_code: string
          review_revision: number
          reviewed_evidence_id: string | null
          reviewer_principal_id: string
        }
        Insert: {
          correction_id: string
          decided_at?: string
          decision: string
          id?: string
          reason_code: string
          review_revision: number
          reviewed_evidence_id?: string | null
          reviewer_principal_id: string
        }
        Update: {
          correction_id?: string
          decided_at?: string
          decision?: string
          id?: string
          reason_code?: string
          review_revision?: number
          reviewed_evidence_id?: string | null
          reviewer_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_assignments_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "correction_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_assignments_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_assignments_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_requests: {
        Row: {
          claimant_principal_id: string
          condition_id: string | null
          correction_kind: string
          correction_revision: number
          decided_at: string | null
          id: string
          state: string
          statement_ciphertext: string
          subject_id: string
          submitted_at: string
        }
        Insert: {
          claimant_principal_id: string
          condition_id?: string | null
          correction_kind: string
          correction_revision: number
          decided_at?: string | null
          id?: string
          state?: string
          statement_ciphertext: string
          subject_id: string
          submitted_at?: string
        }
        Update: {
          claimant_principal_id?: string
          condition_id?: string | null
          correction_kind?: string
          correction_revision?: number
          decided_at?: string | null
          id?: string
          state?: string
          statement_ciphertext?: string
          subject_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_requests_claimant_principal_id_fkey"
            columns: ["claimant_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_requests_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_working_data: {
        Row: {
          correction_id: string
          expires_at: string
          id: string
          working_ciphertext: string
          working_revision: number
        }
        Insert: {
          correction_id: string
          expires_at: string
          id?: string
          working_ciphertext: string
          working_revision: number
        }
        Update: {
          correction_id?: string
          expires_at?: string
          id?: string
          working_ciphertext?: string
          working_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "correction_working_data_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "correction_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      directional_grants: {
        Row: {
          created_at: string
          direction: string
          ended_at: string | null
          grant_id: string
          grant_revision: number
          pair_id: string | null
          recipient_account_id: string | null
          recipient_principal_id: string
          relationship_id: string | null
          relationship_or_pair_revision: number
          status: string
        }
        Insert: {
          created_at?: string
          direction: string
          ended_at?: string | null
          grant_id: string
          grant_revision: number
          pair_id?: string | null
          recipient_account_id?: string | null
          recipient_principal_id: string
          relationship_id?: string | null
          relationship_or_pair_revision: number
          status?: string
        }
        Update: {
          created_at?: string
          direction?: string
          ended_at?: string | null
          grant_id?: string
          grant_revision?: number
          pair_id?: string | null
          recipient_account_id?: string | null
          recipient_principal_id?: string
          relationship_id?: string | null
          relationship_or_pair_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "directional_grants_pair_id_fkey"
            columns: ["pair_id"]
            isOneToOne: false
            referencedRelation: "family_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directional_grants_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directional_grants_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "subject_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      download_ranges: {
        Row: {
          byte_end: number
          byte_start: number
          range_sequence: number
          served_at: string
          session_id: string
        }
        Insert: {
          byte_end: number
          byte_start: number
          range_sequence: number
          served_at?: string
          session_id: string
        }
        Update: {
          byte_end?: number
          byte_start?: number
          range_sequence?: number
          served_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_ranges_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "download_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      download_sessions: {
        Row: {
          account_id: string
          auth_session_id: string
          authorization_fingerprint: string
          created_at: string
          ended_at: string | null
          expires_at: string
          grant_revision: number | null
          id: string
          lifecycle_revision: number
          max_bytes: number
          object_id: string
          principal_id: string
          publication_revision: number
          purpose: string
          served_bytes: number
          session_revision: number
          status: string
          target_id: string
          target_kind: string
        }
        Insert: {
          account_id: string
          auth_session_id: string
          authorization_fingerprint: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          grant_revision?: number | null
          id?: string
          lifecycle_revision: number
          max_bytes: number
          object_id: string
          principal_id: string
          publication_revision: number
          purpose: string
          served_bytes?: number
          session_revision?: number
          status?: string
          target_id: string
          target_kind: string
        }
        Update: {
          account_id?: string
          auth_session_id?: string
          authorization_fingerprint?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          grant_revision?: number | null
          id?: string
          lifecycle_revision?: number
          max_bytes?: number
          object_id?: string
          principal_id?: string
          publication_revision?: number
          purpose?: string
          served_bytes?: number
          session_revision?: number
          status?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_sessions_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "genome_storage_objects"
            referencedColumns: ["object_id"]
          },
          {
            foreignKeyName: "download_sessions_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_participant_slots: {
        Row: {
          adult_draft_id: string | null
          embryo_draft_id: string | null
          id: string
          principal_id: string | null
          slot_kind: string
          slot_revision: number
          state: string
        }
        Insert: {
          adult_draft_id?: string | null
          embryo_draft_id?: string | null
          id?: string
          principal_id?: string | null
          slot_kind: string
          slot_revision: number
          state: string
        }
        Update: {
          adult_draft_id?: string | null
          embryo_draft_id?: string | null
          id?: string
          principal_id?: string | null
          slot_kind?: string
          slot_revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_participant_slots_adult_draft_id_fkey"
            columns: ["adult_draft_id"]
            isOneToOne: false
            referencedRelation: "adult_subject_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_participant_slots_embryo_draft_id_fkey"
            columns: ["embryo_draft_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohort_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_participant_slots_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_basis_bindings: {
        Row: {
          artifact_matrix_fingerprint: string
          basis_case: string
          basis_revision: number
          case_artifact_signature_id: string | null
          cohort_id: string
          created_at: string
          legal_review_id: string | null
          participant_set_revision: number
          reviewed_evidence_id: string | null
        }
        Insert: {
          artifact_matrix_fingerprint: string
          basis_case: string
          basis_revision: number
          case_artifact_signature_id?: string | null
          cohort_id: string
          created_at?: string
          legal_review_id?: string | null
          participant_set_revision: number
          reviewed_evidence_id?: string | null
        }
        Update: {
          artifact_matrix_fingerprint?: string
          basis_case?: string
          basis_revision?: number
          case_artifact_signature_id?: string | null
          cohort_id?: string
          created_at?: string
          legal_review_id?: string | null
          participant_set_revision?: number
          reviewed_evidence_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embryo_basis_bindings_case_artifact_signature_id_fkey"
            columns: ["case_artifact_signature_id"]
            isOneToOne: false
            referencedRelation: "consent_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_basis_bindings_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: true
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_basis_bindings_legal_review_id_fkey"
            columns: ["legal_review_id"]
            isOneToOne: false
            referencedRelation: "legal_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_basis_bindings_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_cohort_drafts: {
        Row: {
          basis_case: string
          basis_revision: number
          created_at: string
          donor_attribution_revision: number
          embryo_count: number
          finalized_at: string | null
          fixed_expires_at: string
          id: string
          owner_account_id: string
          participant_set_revision: number
          state: string
          upload_class: string
          uploader_principal_id: string
        }
        Insert: {
          basis_case: string
          basis_revision?: number
          created_at?: string
          donor_attribution_revision?: number
          embryo_count: number
          finalized_at?: string | null
          fixed_expires_at: string
          id?: string
          owner_account_id: string
          participant_set_revision?: number
          state?: string
          upload_class: string
          uploader_principal_id: string
        }
        Update: {
          basis_case?: string
          basis_revision?: number
          created_at?: string
          donor_attribution_revision?: number
          embryo_count?: number
          finalized_at?: string | null
          fixed_expires_at?: string
          id?: string
          owner_account_id?: string
          participant_set_revision?: number
          state?: string
          upload_class?: string
          uploader_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_cohort_drafts_uploader_principal_id_fkey"
            columns: ["uploader_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_cohorts: {
        Row: {
          basis_case: string
          basis_revision: number
          created_at: string
          donor_attribution_revision: number
          draft_id: string
          embryo_count: number
          id: string
          key_revision: number
          lifecycle_revision: number
          owner_account_id: string
          participant_set_revision: number
          qc_failed_at: string | null
          recipient_set_revision: number
          retention_expires_at: string
          status: string
          upload_class: string
          uploaded_at: string | null
        }
        Insert: {
          basis_case: string
          basis_revision: number
          created_at?: string
          donor_attribution_revision: number
          draft_id: string
          embryo_count: number
          id?: string
          key_revision?: number
          lifecycle_revision?: number
          owner_account_id: string
          participant_set_revision: number
          qc_failed_at?: string | null
          recipient_set_revision?: number
          retention_expires_at: string
          status?: string
          upload_class: string
          uploaded_at?: string | null
        }
        Update: {
          basis_case?: string
          basis_revision?: number
          created_at?: string
          donor_attribution_revision?: number
          draft_id?: string
          embryo_count?: number
          id?: string
          key_revision?: number
          lifecycle_revision?: number
          owner_account_id?: string
          participant_set_revision?: number
          qc_failed_at?: string | null
          recipient_set_revision?: number
          retention_expires_at?: string
          status?: string
          upload_class?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embryo_cohorts_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: true
            referencedRelation: "embryo_cohort_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_disposition_confirmations: {
        Row: {
          authority_revision: number
          confirmed_at: string
          confirmer_principal_id: string
          proposal_id: string
        }
        Insert: {
          authority_revision: number
          confirmed_at?: string
          confirmer_principal_id: string
          proposal_id: string
        }
        Update: {
          authority_revision?: number
          confirmed_at?: string
          confirmer_principal_id?: string
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_disposition_confirmations_confirmer_principal_id_fkey"
            columns: ["confirmer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_disposition_confirmations_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "embryo_disposition_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_disposition_proposals: {
        Row: {
          authority_set_revision: number
          basis_revision: number
          confirmed_at: string | null
          created_at: string
          disposition: string
          embryo_id: string
          expires_at: string
          id: string
          proposer_principal_id: string
          status: string
        }
        Insert: {
          authority_set_revision: number
          basis_revision: number
          confirmed_at?: string | null
          created_at?: string
          disposition: string
          embryo_id: string
          expires_at: string
          id?: string
          proposer_principal_id: string
          status?: string
        }
        Update: {
          authority_set_revision?: number
          basis_revision?: number
          confirmed_at?: string | null
          created_at?: string
          disposition?: string
          embryo_id?: string
          expires_at?: string
          id?: string
          proposer_principal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_disposition_proposals_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_disposition_proposals_proposer_principal_id_fkey"
            columns: ["proposer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_donor_attributions: {
        Row: {
          attribution_revision: number
          classification: string
          cohort_id: string
          created_at: string
          donor_principal_id: string | null
          donor_slot: string
          id: string
          revoked_at: string | null
          signature_id: string | null
        }
        Insert: {
          attribution_revision: number
          classification: string
          cohort_id: string
          created_at?: string
          donor_principal_id?: string | null
          donor_slot: string
          id?: string
          revoked_at?: string | null
          signature_id?: string | null
        }
        Update: {
          attribution_revision?: number
          classification?: string
          cohort_id?: string
          created_at?: string
          donor_principal_id?: string | null
          donor_slot?: string
          id?: string
          revoked_at?: string | null
          signature_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embryo_donor_attributions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_donor_attributions_donor_principal_id_fkey"
            columns: ["donor_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_donor_attributions_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "consent_signatures"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_draft_participants: {
        Row: {
          draft_id: string
          membership_revision: number
          principal_id: string
          set_kind: string
          set_revision: number
        }
        Insert: {
          draft_id: string
          membership_revision: number
          principal_id: string
          set_kind: string
          set_revision: number
        }
        Update: {
          draft_id?: string
          membership_revision?: number
          principal_id?: string
          set_kind?: string
          set_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "embryo_draft_participants_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohort_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_draft_participants_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_figures: {
        Row: {
          created_at: string
          figure_kind: string
          figure_revision: number
          finding_id: string
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          figure_kind: string
          figure_revision: number
          finding_id: string
          id?: string
          payload: Json
        }
        Update: {
          created_at?: string
          figure_kind?: string
          figure_revision?: number
          finding_id?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "embryo_figures_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "embryo_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_fragment_handle_maps: {
        Row: {
          consumed_at: string | null
          handle_hash: string
          sample_ordinal: number
          session_id: string
        }
        Insert: {
          consumed_at?: string | null
          handle_hash: string
          sample_ordinal: number
          session_id: string
        }
        Update: {
          consumed_at?: string | null
          handle_hash?: string
          sample_ordinal?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_fragment_handle_maps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "embryo_ingest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_ingest_fragments: {
        Row: {
          byte_count: number
          content_sha256: string
          created_at: string
          line_count: number
          object_id: string
          sequence: number
          session_id: string
        }
        Insert: {
          byte_count: number
          content_sha256: string
          created_at?: string
          line_count: number
          object_id: string
          sequence: number
          session_id: string
        }
        Update: {
          byte_count?: number
          content_sha256?: string
          created_at?: string
          line_count?: number
          object_id?: string
          sequence?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_ingest_fragments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "embryo_ingest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_ingest_sessions: {
        Row: {
          accepted_bytes: number
          accepted_chunks: number
          basis_case: string
          basis_revision: number
          cohort_id: string
          completed_at: string | null
          created_at: string
          donor_attribution_revision: number
          expected_next_sequence: number
          expires_at: string
          id: string
          originating_session_id: string
          participant_set_revision: number
          source_binding_fingerprint: string
          status: string
          uploader_principal_id: string
        }
        Insert: {
          accepted_bytes?: number
          accepted_chunks?: number
          basis_case: string
          basis_revision: number
          cohort_id: string
          completed_at?: string | null
          created_at?: string
          donor_attribution_revision: number
          expected_next_sequence?: number
          expires_at: string
          id?: string
          originating_session_id: string
          participant_set_revision: number
          source_binding_fingerprint: string
          status?: string
          uploader_principal_id: string
        }
        Update: {
          accepted_bytes?: number
          accepted_chunks?: number
          basis_case?: string
          basis_revision?: number
          cohort_id?: string
          completed_at?: string | null
          created_at?: string
          donor_attribution_revision?: number
          expected_next_sequence?: number
          expires_at?: string
          id?: string
          originating_session_id?: string
          participant_set_revision?: number
          source_binding_fingerprint?: string
          status?: string
          uploader_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_ingest_sessions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_ingest_sessions_uploader_principal_id_fkey"
            columns: ["uploader_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_mapping_challenges: {
        Row: {
          created_at: string
          expires_at: string
          handle_manifest_fingerprint: string
          id: string
          ingest_session_id: string
          mapping_revision: number
          state: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          handle_manifest_fingerprint: string
          id?: string
          ingest_session_id: string
          mapping_revision: number
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          handle_manifest_fingerprint?: string
          id?: string
          ingest_session_id?: string
          mapping_revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_mapping_challenges_ingest_session_id_fkey"
            columns: ["ingest_session_id"]
            isOneToOne: false
            referencedRelation: "embryo_ingest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_participant_sets: {
        Row: {
          cohort_id: string
          created_at: string
          membership_revision: number
          principal_id: string
          revoked_at: string | null
          set_kind: string
          set_revision: number
        }
        Insert: {
          cohort_id: string
          created_at?: string
          membership_revision: number
          principal_id: string
          revoked_at?: string | null
          set_kind: string
          set_revision: number
        }
        Update: {
          cohort_id?: string
          created_at?: string
          membership_revision?: number
          principal_id?: string
          revoked_at?: string | null
          set_kind?: string
          set_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "embryo_participant_sets_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_participant_sets_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_qc: {
        Row: {
          allelic_dropout_estimate: number | null
          allelic_dropout_interval_high: number | null
          allelic_dropout_interval_low: number | null
          allelic_dropout_method: string | null
          amplification_method: string | null
          autosomal_het_rate: number | null
          call_rate: number
          computed_at: string
          contamination_estimate: number | null
          embryo_id: string
          imputation_panel: string | null
          imputation_performed: boolean
          mean_depth: number | null
          parent_a_concordance: number | null
          parent_b_concordance: number | null
          qc_reasons: string[]
          qc_verdict: string
          sites_called: number
          sites_expected: number
          source_assay: string | null
          source_laboratory: string | null
        }
        Insert: {
          allelic_dropout_estimate?: number | null
          allelic_dropout_interval_high?: number | null
          allelic_dropout_interval_low?: number | null
          allelic_dropout_method?: string | null
          amplification_method?: string | null
          autosomal_het_rate?: number | null
          call_rate: number
          computed_at?: string
          contamination_estimate?: number | null
          embryo_id: string
          imputation_panel?: string | null
          imputation_performed?: boolean
          mean_depth?: number | null
          parent_a_concordance?: number | null
          parent_b_concordance?: number | null
          qc_reasons?: string[]
          qc_verdict: string
          sites_called: number
          sites_expected: number
          source_assay?: string | null
          source_laboratory?: string | null
        }
        Update: {
          allelic_dropout_estimate?: number | null
          allelic_dropout_interval_high?: number | null
          allelic_dropout_interval_low?: number | null
          allelic_dropout_method?: string | null
          amplification_method?: string | null
          autosomal_het_rate?: number | null
          call_rate?: number
          computed_at?: string
          contamination_estimate?: number | null
          embryo_id?: string
          imputation_panel?: string | null
          imputation_performed?: boolean
          mean_depth?: number | null
          parent_a_concordance?: number | null
          parent_b_concordance?: number | null
          qc_reasons?: string[]
          qc_verdict?: string
          sites_called?: number
          sites_expected?: number
          source_assay?: string | null
          source_laboratory?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embryo_qc_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: true
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_scores: {
        Row: {
          citation_ids: string[]
          computation_revision: number
          computed_at: string
          condition_id: string
          condition_name: string
          coverage_state: string
          embryo_id: string
          evidence_label: string
          finding: Json | null
          id: string
          model_id: string | null
          model_version: string | null
          not_covered_reason: string | null
          source_binding_fingerprint: string
        }
        Insert: {
          citation_ids?: string[]
          computation_revision: number
          computed_at?: string
          condition_id: string
          condition_name: string
          coverage_state: string
          embryo_id: string
          evidence_label: string
          finding?: Json | null
          id?: string
          model_id?: string | null
          model_version?: string | null
          not_covered_reason?: string | null
          source_binding_fingerprint: string
        }
        Update: {
          citation_ids?: string[]
          computation_revision?: number
          computed_at?: string
          condition_id?: string
          condition_name?: string
          coverage_state?: string
          embryo_id?: string
          evidence_label?: string
          finding?: Json | null
          id?: string
          model_id?: string | null
          model_version?: string | null
          not_covered_reason?: string | null
          source_binding_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryo_scores_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
        ]
      }
      embryo_variants: {
        Row: {
          alternate_allele: string | null
          chromosome: number
          embryo_id: string
          genotype: string
          id: number
          position: number
          reference_allele: string | null
          source_binding_fingerprint: string
          source_file_id: string | null
        }
        Insert: {
          alternate_allele?: string | null
          chromosome: number
          embryo_id: string
          genotype: string
          id?: never
          position: number
          reference_allele?: string | null
          source_binding_fingerprint: string
          source_file_id?: string | null
        }
        Update: {
          alternate_allele?: string | null
          chromosome?: number
          embryo_id?: string
          genotype?: string
          id?: never
          position?: number
          reference_allele?: string | null
          source_binding_fingerprint?: string
          source_file_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "embryo_variants_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryo_variants_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
        ]
      }
      embryos: {
        Row: {
          cohort_id: string
          created_at: string
          display_label: string | null
          disposition_revision: number
          id: string
          retention_expires_at: string
          sample_ordinal: number
          status: string
          subject_id: string
        }
        Insert: {
          cohort_id: string
          created_at?: string
          display_label?: string | null
          disposition_revision?: number
          id?: string
          retention_expires_at: string
          sample_ordinal: number
          status?: string
          subject_id: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          display_label?: string | null
          disposition_revision?: number
          id?: string
          retention_expires_at?: string
          sample_ordinal?: number
          status?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embryos_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embryos_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: true
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      encrypted_contact_references: {
        Row: {
          authority_revision: number
          contact_ciphertext: string | null
          contact_hmac: string
          created_at: string
          ended_at: string | null
          id: string
          key_revision: number
          principal_id: string
          status: string
        }
        Insert: {
          authority_revision: number
          contact_ciphertext?: string | null
          contact_hmac: string
          created_at?: string
          ended_at?: string | null
          id?: string
          key_revision: number
          principal_id: string
          status?: string
        }
        Update: {
          authority_revision?: number
          contact_ciphertext?: string | null
          contact_hmac?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          key_revision?: number
          principal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "encrypted_contact_references_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      family_pairs: {
        Row: {
          created_at: string
          id: string
          pair_revision: number
          status: string
          subject_a_id: string
          subject_b_id: string
          subject_high_id: string | null
          subject_low_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          pair_revision?: number
          status?: string
          subject_a_id: string
          subject_b_id: string
          subject_high_id?: string | null
          subject_low_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          pair_revision?: number
          status?: string
          subject_a_id?: string
          subject_b_id?: string
          subject_high_id?: string | null
          subject_low_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_pairs_subject_a_id_fkey"
            columns: ["subject_a_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_pairs_subject_b_id_fkey"
            columns: ["subject_b_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_assignments: {
        Row: {
          claim_id: string
          decided_at: string
          decision: string
          evidence_revision: number
          id: string
          reason_code: string
          review_revision: number
          reviewer_principal_id: string
        }
        Insert: {
          claim_id: string
          decided_at?: string
          decision: string
          evidence_revision: number
          id?: string
          reason_code: string
          review_revision: number
          reviewer_principal_id: string
        }
        Update: {
          claim_id?: string
          decided_at?: string
          decision?: string
          evidence_revision?: number
          id?: string
          reason_code?: string
          review_revision?: number
          reviewer_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_assignments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_assignments_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_documents: {
        Row: {
          claim_id: string
          evidence_kind: string
          evidence_revision: number
          id: string
          reviewed_evidence_id: string
          status: string
        }
        Insert: {
          claim_id: string
          evidence_kind: string
          evidence_revision: number
          id?: string
          reviewed_evidence_id: string
          status: string
        }
        Update: {
          claim_id?: string
          evidence_kind?: string
          evidence_revision?: number
          id?: string
          reviewed_evidence_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_documents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_documents_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_notices: {
        Row: {
          claim_id: string
          created_at: string
          id: string
          notice_kind: string
          notice_revision: number
          outbox_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          id?: string
          notice_kind: string
          notice_revision: number
          outbox_id: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          id?: string
          notice_kind?: string
          notice_revision?: number
          outbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_notices_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_notices_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "mail_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_objections: {
        Row: {
          claim_id: string
          decided_at: string | null
          id: string
          objection_revision: number
          objector_principal_id: string
          reason_code: string
          reviewed_evidence_id: string | null
          status: string
          submitted_at: string
        }
        Insert: {
          claim_id: string
          decided_at?: string | null
          id?: string
          objection_revision: number
          objector_principal_id: string
          reason_code: string
          reviewed_evidence_id?: string | null
          status?: string
          submitted_at?: string
        }
        Update: {
          claim_id?: string
          decided_at?: string | null
          id?: string
          objection_revision?: number
          objector_principal_id?: string
          reason_code?: string
          reviewed_evidence_id?: string | null
          status?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_objections_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_objections_objector_principal_id_fkey"
            columns: ["objector_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_objections_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_release_credentials: {
        Row: {
          claim_id: string
          claimant_principal_id: string
          created_at: string
          credential_hash: string
          credential_revision: number
          expires_at: string
          id: string
          status: string
        }
        Insert: {
          claim_id: string
          claimant_principal_id: string
          created_at?: string
          credential_hash: string
          credential_revision: number
          expires_at: string
          id?: string
          status: string
        }
        Update: {
          claim_id?: string
          claimant_principal_id?: string
          created_at?: string
          credential_hash?: string
          credential_revision?: number
          expires_at?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_release_credenti_claimant_principal_id_fkey"
            columns: ["claimant_principal_id"]
            isOneToOne: false
            referencedRelation: "future_person_claimant_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_release_credentials_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_review_packages: {
        Row: {
          claim_id: string
          created_at: string
          expires_at: string
          id: string
          package_fingerprint: string
          package_revision: number
          state: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          expires_at: string
          id?: string
          package_fingerprint: string
          package_revision: number
          state: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          package_fingerprint?: string
          package_revision?: number
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_review_packages_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claim_sessions: {
        Row: {
          auth_session_id: string | null
          candidate_principal_id: string
          created_at: string
          embryo_id: string
          ended_at: string | null
          expires_at: string
          id: string
          intake_revision: number
          record_key_recipient_principal_id: string | null
          record_key_revision: number | null
          state: string
        }
        Insert: {
          auth_session_id?: string | null
          candidate_principal_id: string
          created_at?: string
          embryo_id: string
          ended_at?: string | null
          expires_at: string
          id?: string
          intake_revision: number
          record_key_recipient_principal_id?: string | null
          record_key_revision?: number | null
          state?: string
        }
        Update: {
          auth_session_id?: string | null
          candidate_principal_id?: string
          created_at?: string
          embryo_id?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          intake_revision?: number
          record_key_recipient_principal_id?: string | null
          record_key_revision?: number | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claim_sessions_candidate_principal_id_fkey"
            columns: ["candidate_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_sessions_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claim_sessions_embryo_id_record_key_recipien_fkey"
            columns: [
              "embryo_id",
              "record_key_recipient_principal_id",
              "record_key_revision",
            ]
            isOneToOne: false
            referencedRelation: "future_person_record_key_hashes"
            referencedColumns: [
              "embryo_id",
              "recipient_principal_id",
              "key_revision",
            ]
          },
        ]
      }
      future_person_claimant_identity_hmacs: {
        Row: {
          claimant_principal_id: string
          expires_at: string
          hmac_key_revision: number
          identity_hmac: string
        }
        Insert: {
          claimant_principal_id: string
          expires_at: string
          hmac_key_revision: number
          identity_hmac: string
        }
        Update: {
          claimant_principal_id?: string
          expires_at?: string
          hmac_key_revision?: number
          identity_hmac?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claimant_identity_hmac_claimant_principal_id_fkey"
            columns: ["claimant_principal_id"]
            isOneToOne: false
            referencedRelation: "future_person_claimant_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claimant_principals: {
        Row: {
          claim_id: string
          claimant_revision: number
          created_at: string
          id: string
          principal_id: string
          status: string
        }
        Insert: {
          claim_id: string
          claimant_revision: number
          created_at?: string
          id?: string
          principal_id: string
          status: string
        }
        Update: {
          claim_id?: string
          claimant_revision?: number
          created_at?: string
          id?: string
          principal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claimant_principals_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "future_person_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claimant_principals_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_claims: {
        Row: {
          claim_method: string
          claim_revision: number
          claimant_account_id: string | null
          claimant_principal_id: string
          claimant_revision: number
          decided_at: string | null
          embryo_id: string
          id: string
          identity_id: string | null
          intake_session_id: string
          status: string
          submitted_at: string
        }
        Insert: {
          claim_method: string
          claim_revision: number
          claimant_account_id?: string | null
          claimant_principal_id: string
          claimant_revision: number
          decided_at?: string | null
          embryo_id: string
          id?: string
          identity_id?: string | null
          intake_session_id: string
          status?: string
          submitted_at?: string
        }
        Update: {
          claim_method?: string
          claim_revision?: number
          claimant_account_id?: string | null
          claimant_principal_id?: string
          claimant_revision?: number
          decided_at?: string | null
          embryo_id?: string
          id?: string
          identity_id?: string | null
          intake_session_id?: string
          status?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_claims_claimant_principal_id_fkey"
            columns: ["claimant_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claims_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claims_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "future_person_identity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_claims_intake_session_id_fkey"
            columns: ["intake_session_id"]
            isOneToOne: true
            referencedRelation: "future_person_claim_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_identity: {
        Row: {
          created_at: string
          embryo_id: string
          ended_at: string | null
          envelope_key_revision: number
          hmac_key_revision: number
          id: string
          identity_hmac: string
          identity_revision: number
          parent_supplied_ciphertext: string
          state: string
        }
        Insert: {
          created_at?: string
          embryo_id: string
          ended_at?: string | null
          envelope_key_revision: number
          hmac_key_revision: number
          id?: string
          identity_hmac: string
          identity_revision: number
          parent_supplied_ciphertext: string
          state?: string
        }
        Update: {
          created_at?: string
          embryo_id?: string
          ended_at?: string | null
          envelope_key_revision?: number
          hmac_key_revision?: number
          id?: string
          identity_hmac?: string
          identity_revision?: number
          parent_supplied_ciphertext?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_identity_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_record_key_hashes: {
        Row: {
          created_at: string
          embryo_id: string
          ended_at: string | null
          key_hash: string
          key_revision: number
          recipient_principal_id: string
          recipient_set_revision: number
          status: string
        }
        Insert: {
          created_at?: string
          embryo_id: string
          ended_at?: string | null
          key_hash: string
          key_revision: number
          recipient_principal_id: string
          recipient_set_revision: number
          status?: string
        }
        Update: {
          created_at?: string
          embryo_id?: string
          ended_at?: string | null
          key_hash?: string
          key_revision?: number
          recipient_principal_id?: string
          recipient_set_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_record_key_hashes_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_record_key_hashes_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_record_key_print_rights: {
        Row: {
          consumed_at: string | null
          created_at: string
          embryo_id: string
          id: string
          key_revision: number
          recipient_principal_id: string
          recipient_set_revision: number
          status: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          embryo_id: string
          id?: string
          key_revision: number
          recipient_principal_id: string
          recipient_set_revision: number
          status?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          embryo_id?: string
          id?: string
          key_revision?: number
          recipient_principal_id?: string
          recipient_set_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_record_key_print_righ_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_record_key_print_rights_embryo_id_fkey"
            columns: ["embryo_id"]
            isOneToOne: false
            referencedRelation: "embryos"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_record_key_recipients: {
        Row: {
          authority_revision: number
          cohort_id: string
          created_at: string
          ended_at: string | null
          recipient_principal_id: string
          recipient_set_revision: number
          status: string
        }
        Insert: {
          authority_revision: number
          cohort_id: string
          created_at?: string
          ended_at?: string | null
          recipient_principal_id: string
          recipient_set_revision: number
          status?: string
        }
        Update: {
          authority_revision?: number
          cohort_id?: string
          created_at?: string
          ended_at?: string | null
          recipient_principal_id?: string
          recipient_set_revision?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_record_key_recipients_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "future_person_record_key_recipients_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      future_person_recovery_key_hashes: {
        Row: {
          claimant_principal_id: string
          created_at: string
          key_revision: number
          recovery_key_hash: string
          status: string
        }
        Insert: {
          claimant_principal_id: string
          created_at?: string
          key_revision: number
          recovery_key_hash: string
          status: string
        }
        Update: {
          claimant_principal_id?: string
          created_at?: string
          key_revision?: number
          recovery_key_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "future_person_recovery_key_hashes_claimant_principal_id_fkey"
            columns: ["claimant_principal_id"]
            isOneToOne: false
            referencedRelation: "future_person_claimant_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_exports: {
        Row: {
          account_id: string
          archive_sha256: string | null
          byte_count: number | null
          completed_at: string | null
          expires_at: string | null
          export_kind: string
          export_revision: number
          grant_revision: number | null
          id: string
          lifecycle_revision: number
          manifest: Json
          manifest_sha256: string | null
          object_id: string | null
          principal_graph_fingerprint: string
          principal_graph_revision: number
          purpose: string
          requested_at: string
          requester_principal_id: string
          status: string
          subject_partitions: Json
          target_id: string
          target_kind: string
        }
        Insert: {
          account_id: string
          archive_sha256?: string | null
          byte_count?: number | null
          completed_at?: string | null
          expires_at?: string | null
          export_kind: string
          export_revision: number
          grant_revision?: number | null
          id?: string
          lifecycle_revision: number
          manifest?: Json
          manifest_sha256?: string | null
          object_id?: string | null
          principal_graph_fingerprint: string
          principal_graph_revision: number
          purpose: string
          requested_at?: string
          requester_principal_id: string
          status?: string
          subject_partitions?: Json
          target_id: string
          target_kind: string
        }
        Update: {
          account_id?: string
          archive_sha256?: string | null
          byte_count?: number | null
          completed_at?: string | null
          expires_at?: string | null
          export_kind?: string
          export_revision?: number
          grant_revision?: number | null
          id?: string
          lifecycle_revision?: number
          manifest?: Json
          manifest_sha256?: string | null
          object_id?: string | null
          principal_graph_fingerprint?: string
          principal_graph_revision?: number
          purpose?: string
          requested_at?: string
          requester_principal_id?: string
          status?: string
          subject_partitions?: Json
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_exports_object_fk"
            columns: ["object_id"]
            isOneToOne: true
            referencedRelation: "genome_storage_objects"
            referencedColumns: ["object_id"]
          },
          {
            foreignKeyName: "generated_exports_requester_principal_id_fkey"
            columns: ["requester_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      genome_files: {
        Row: {
          bucket_path: string
          build: string | null
          canonical_build: string | null
          cohort_id: string | null
          created_at: string
          error: string | null
          file_type: Database["public"]["Enums"]["genome_file_type"]
          id: string
          is_cohort_file: boolean
          original_name: string
          processing_finished_at: string | null
          processing_started_at: string | null
          sample_count: number
          sha256: string | null
          single_logical_sample_verified_at: string | null
          size_bytes: number
          source_binding_fingerprint: string | null
          source_publication_revision: number
          source_publication_state: string
          source_sha256: string | null
          status: Database["public"]["Enums"]["genome_file_status"]
          storage_object_id: string | null
          structural_validator_version: string | null
          subject_id: string | null
          tier: number
          upload_revision: number
          user_id: string
          variant_count: number | null
        }
        Insert: {
          bucket_path: string
          build?: string | null
          canonical_build?: string | null
          cohort_id?: string | null
          created_at?: string
          error?: string | null
          file_type: Database["public"]["Enums"]["genome_file_type"]
          id?: string
          is_cohort_file?: boolean
          original_name: string
          processing_finished_at?: string | null
          processing_started_at?: string | null
          sample_count?: number
          sha256?: string | null
          single_logical_sample_verified_at?: string | null
          size_bytes: number
          source_binding_fingerprint?: string | null
          source_publication_revision?: number
          source_publication_state?: string
          source_sha256?: string | null
          status?: Database["public"]["Enums"]["genome_file_status"]
          storage_object_id?: string | null
          structural_validator_version?: string | null
          subject_id?: string | null
          tier: number
          upload_revision?: number
          user_id: string
          variant_count?: number | null
        }
        Update: {
          bucket_path?: string
          build?: string | null
          canonical_build?: string | null
          cohort_id?: string | null
          created_at?: string
          error?: string | null
          file_type?: Database["public"]["Enums"]["genome_file_type"]
          id?: string
          is_cohort_file?: boolean
          original_name?: string
          processing_finished_at?: string | null
          processing_started_at?: string | null
          sample_count?: number
          sha256?: string | null
          single_logical_sample_verified_at?: string | null
          size_bytes?: number
          source_binding_fingerprint?: string | null
          source_publication_revision?: number
          source_publication_state?: string
          source_sha256?: string | null
          status?: Database["public"]["Enums"]["genome_file_status"]
          storage_object_id?: string | null
          structural_validator_version?: string | null
          subject_id?: string | null
          tier?: number
          upload_revision?: number
          user_id?: string
          variant_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "genome_files_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genome_files_storage_object_fk"
            columns: ["storage_object_id"]
            isOneToOne: false
            referencedRelation: "genome_storage_objects"
            referencedColumns: ["object_id"]
          },
          {
            foreignKeyName: "genome_files_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      genome_storage_objects: {
        Row: {
          bucket_id: string
          byte_count: number
          cohort_id: string | null
          created_at: string
          generated_export_id: string | null
          genome_file_id: string | null
          object_id: string
          object_name: string
          object_revision: number
          revoked_at: string | null
          sha256: string
          state: string
        }
        Insert: {
          bucket_id: string
          byte_count: number
          cohort_id?: string | null
          created_at?: string
          generated_export_id?: string | null
          genome_file_id?: string | null
          object_id: string
          object_name: string
          object_revision: number
          revoked_at?: string | null
          sha256: string
          state?: string
        }
        Update: {
          bucket_id?: string
          byte_count?: number
          cohort_id?: string | null
          created_at?: string
          generated_export_id?: string | null
          genome_file_id?: string | null
          object_id?: string
          object_name?: string
          object_revision?: number
          revoked_at?: string | null
          sha256?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "genome_storage_objects_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genome_storage_objects_generated_export_id_fkey"
            columns: ["generated_export_id"]
            isOneToOne: false
            referencedRelation: "generated_exports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genome_storage_objects_genome_file_id_fkey"
            columns: ["genome_file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_candidates: {
        Row: {
          candidate_revision: number
          contact_reference_id: string
          created_at: string
          draft_slot_id: string
          id: string
          invitation_id: string | null
          state: string
        }
        Insert: {
          candidate_revision: number
          contact_reference_id: string
          created_at?: string
          draft_slot_id: string
          id?: string
          invitation_id?: string | null
          state: string
        }
        Update: {
          candidate_revision?: number
          contact_reference_id?: string
          created_at?: string
          draft_slot_id?: string
          id?: string
          invitation_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_candidates_contact_reference_id_fkey"
            columns: ["contact_reference_id"]
            isOneToOne: false
            referencedRelation: "encrypted_contact_references"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_candidates_draft_slot_id_fkey"
            columns: ["draft_slot_id"]
            isOneToOne: false
            referencedRelation: "draft_participant_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_candidates_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "subject_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_refusal_hmacs: {
        Row: {
          created_at: string
          email_hmac: string
          expires_at: string
          refusal_revision: number
        }
        Insert: {
          created_at?: string
          email_hmac: string
          expires_at: string
          refusal_revision: number
        }
        Update: {
          created_at?: string
          email_hmac?: string
          expires_at?: string
          refusal_revision?: number
        }
        Relationships: []
      }
      invitation_reminders: {
        Row: {
          created_at: string
          id: string
          invitation_id: string
          outbox_id: string
          reminder_revision: number
        }
        Insert: {
          created_at?: string
          id?: string
          invitation_id: string
          outbox_id: string
          reminder_revision: number
        }
        Update: {
          created_at?: string
          id?: string
          invitation_id?: string
          outbox_id?: string
          reminder_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "invitation_reminders_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "subject_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_reminders_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "mail_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_audit_log: {
        Row: {
          audit_principal_id: string | null
          coded_context: Json
          event_code: string
          occurred_at: string
          outcome_code: string
          previous_hash: string
          route_id: string | null
          row_hash: string
          seq: number
        }
        Insert: {
          audit_principal_id?: string | null
          coded_context?: Json
          event_code: string
          occurred_at: string
          outcome_code: string
          previous_hash: string
          route_id?: string | null
          row_hash: string
          seq: number
        }
        Update: {
          audit_principal_id?: string | null
          coded_context?: Json
          event_code?: string
          occurred_at?: string
          outcome_code?: string
          previous_hash?: string
          route_id?: string | null
          row_hash?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "legal_audit_log_audit_principal_id_fkey"
            columns: ["audit_principal_id"]
            isOneToOne: false
            referencedRelation: "audit_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_audit_retention_checkpoints: {
        Row: {
          checkpoint_hash: string
          created_at: string
          first_retained_prev_hash: string | null
          first_retained_seq: number | null
          id: number
          phase_revision: number
          removed_through_occurred_at: string
          removed_through_row_hash: string
          removed_through_seq: number
          retention_row_id: string
          row_count: number
        }
        Insert: {
          checkpoint_hash: string
          created_at?: string
          first_retained_prev_hash?: string | null
          first_retained_seq?: number | null
          id?: never
          phase_revision: number
          removed_through_occurred_at: string
          removed_through_row_hash: string
          removed_through_seq: number
          retention_row_id: string
          row_count: number
        }
        Update: {
          checkpoint_hash?: string
          created_at?: string
          first_retained_prev_hash?: string | null
          first_retained_seq?: number | null
          id?: never
          phase_revision?: number
          removed_through_occurred_at?: string
          removed_through_row_hash?: string
          removed_through_seq?: number
          retention_row_id?: string
          row_count?: number
        }
        Relationships: []
      }
      legal_evidence_assignments: {
        Row: {
          assignment_revision: number
          created_at: string
          document_id: string
          id: string
          reviewer_principal_id: string
          status: string
        }
        Insert: {
          assignment_revision: number
          created_at?: string
          document_id: string
          id?: string
          reviewer_principal_id: string
          status: string
        }
        Update: {
          assignment_revision?: number
          created_at?: string
          document_id?: string
          id?: string
          reviewer_principal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_assignments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_evidence_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_evidence_assignments_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_evidence_documents: {
        Row: {
          created_at: string
          document_kind: string
          document_revision: number
          document_sha256: string
          envelope_key_revision: number
          id: string
          object_id: string
          reviewed_evidence_id: string | null
          session_id: string
          state: string
        }
        Insert: {
          created_at?: string
          document_kind: string
          document_revision: number
          document_sha256: string
          envelope_key_revision: number
          id?: string
          object_id: string
          reviewed_evidence_id?: string | null
          session_id: string
          state: string
        }
        Update: {
          created_at?: string
          document_kind?: string
          document_revision?: number
          document_sha256?: string
          envelope_key_revision?: number
          id?: string
          object_id?: string
          reviewed_evidence_id?: string | null
          session_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_documents_reviewed_evidence_id_fkey"
            columns: ["reviewed_evidence_id"]
            isOneToOne: false
            referencedRelation: "reviewed_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_evidence_documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "legal_evidence_ingest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_evidence_fragments: {
        Row: {
          byte_count: number
          fragment_ordinal: number
          object_id: string
          session_id: string
          sha256: string
        }
        Insert: {
          byte_count: number
          fragment_ordinal: number
          object_id: string
          session_id: string
          sha256: string
        }
        Update: {
          byte_count?: number
          fragment_ordinal?: number
          object_id?: string
          session_id?: string
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_fragments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "legal_evidence_ingest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_evidence_ingest_sessions: {
        Row: {
          created_at: string
          evidence_kind: string
          expires_at: string
          id: string
          principal_id: string
          session_revision: number
          state: string
          target_id: string
          target_kind: string
        }
        Insert: {
          created_at?: string
          evidence_kind: string
          expires_at: string
          id?: string
          principal_id: string
          session_revision: number
          state: string
          target_id: string
          target_kind: string
        }
        Update: {
          created_at?: string
          evidence_kind?: string
          expires_at?: string
          id?: string
          principal_id?: string
          session_revision?: number
          state?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_ingest_sessions_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_evidence_review_copies: {
        Row: {
          copy_revision: number
          document_id: string
          expires_at: string
          id: string
          object_id: string
          reviewer_principal_id: string
        }
        Insert: {
          copy_revision: number
          document_id: string
          expires_at: string
          id?: string
          object_id: string
          reviewer_principal_id: string
        }
        Update: {
          copy_revision?: number
          document_id?: string
          expires_at?: string
          id?: string
          object_id?: string
          reviewer_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_review_copies_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_evidence_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_evidence_review_copies_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_evidence_working_data: {
        Row: {
          document_id: string
          expires_at: string
          id: string
          working_ciphertext: string
          working_revision: number
        }
        Insert: {
          document_id: string
          expires_at: string
          id?: string
          working_ciphertext: string
          working_revision: number
        }
        Update: {
          document_id?: string
          expires_at?: string
          id?: string
          working_ciphertext?: string
          working_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "legal_evidence_working_data_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_evidence_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_reviews: {
        Row: {
          decision: string
          decision_code: string
          id: string
          review_revision: number
          reviewed_at: string
          reviewer_principal_id: string
          target_id: string
          target_kind: string
        }
        Insert: {
          decision: string
          decision_code: string
          id?: string
          review_revision: number
          reviewed_at?: string
          reviewer_principal_id: string
          target_id: string
          target_kind: string
        }
        Update: {
          decision?: string
          decision_code?: string
          id?: string
          review_revision?: number
          reviewed_at?: string
          reviewer_principal_id?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_reviews_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_keys: {
        Row: {
          encrypted_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          encrypted_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          encrypted_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_settings: {
        Row: {
          base_url: string | null
          key_last4: string | null
          model: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url?: string | null
          key_last4?: string | null
          model: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string | null
          key_last4?: string | null
          model?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mail_deliveries: {
        Row: {
          id: string
          occurred_at: string
          outbox_id: string
          provider_attempt_id: string
          provider_event_hmac: string | null
          recorded_at: string
          status: string
        }
        Insert: {
          id?: string
          occurred_at: string
          outbox_id: string
          provider_attempt_id: string
          provider_event_hmac?: string | null
          recorded_at?: string
          status: string
        }
        Update: {
          id?: string
          occurred_at?: string
          outbox_id?: string
          provider_attempt_id?: string
          provider_event_hmac?: string | null
          recorded_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_deliveries_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "mail_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_deliveries_provider_attempt_id_fkey"
            columns: ["provider_attempt_id"]
            isOneToOne: false
            referencedRelation: "mail_provider_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_outbox: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          contact_reference_id: string
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          last_outcome_code: string | null
          not_before: string
          purpose: string
          recipient_authority_revision: number
          recipient_principal_id: string
          semantic_revision: number
          state: string
          target_id: string
          target_kind: string
          template_id: string
          template_payload: Json
          token_purpose: string | null
          token_target_id: string | null
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          contact_reference_id: string
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key: string
          last_outcome_code?: string | null
          not_before?: string
          purpose: string
          recipient_authority_revision: number
          recipient_principal_id: string
          semantic_revision: number
          state?: string
          target_id: string
          target_kind: string
          template_id: string
          template_payload?: Json
          token_purpose?: string | null
          token_target_id?: string | null
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          contact_reference_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          last_outcome_code?: string | null
          not_before?: string
          purpose?: string
          recipient_authority_revision?: number
          recipient_principal_id?: string
          semantic_revision?: number
          state?: string
          target_id?: string
          target_kind?: string
          template_id?: string
          template_payload?: Json
          token_purpose?: string | null
          token_target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_outbox_contact_reference_id_fkey"
            columns: ["contact_reference_id"]
            isOneToOne: false
            referencedRelation: "encrypted_contact_references"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_provider_attempts: {
        Row: {
          attempt_ordinal: number
          completed_at: string | null
          id: string
          outbox_id: string
          outcome_code: string | null
          provider: string
          provider_message_id_hmac: string | null
          submitted_at: string | null
        }
        Insert: {
          attempt_ordinal: number
          completed_at?: string | null
          id?: string
          outbox_id: string
          outcome_code?: string | null
          provider: string
          provider_message_id_hmac?: string | null
          submitted_at?: string | null
        }
        Update: {
          attempt_ordinal?: number
          completed_at?: string | null
          id?: string
          outbox_id?: string
          outcome_code?: string | null
          provider?: string
          provider_message_id_hmac?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_provider_attempts_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "mail_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      model_contexts: {
        Row: {
          context_fingerprint: string
          context_revision: number
          created_at: string
          generation_session_id: string
          id: string
          provider_classification: string
          state: string
        }
        Insert: {
          context_fingerprint: string
          context_revision: number
          created_at?: string
          generation_session_id: string
          id?: string
          provider_classification: string
          state: string
        }
        Update: {
          context_fingerprint?: string
          context_revision?: number
          created_at?: string
          generation_session_id?: string
          id?: string
          provider_classification?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_contexts_generation_session_id_fkey"
            columns: ["generation_session_id"]
            isOneToOne: false
            referencedRelation: "copilot_generation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_source_rows: {
        Row: {
          cohort_id: string | null
          created_at: string
          id: string
          source_revision: number
          state: string
          subject_id: string | null
          worker_job_id: string
        }
        Insert: {
          cohort_id?: string | null
          created_at?: string
          id?: string
          source_revision: number
          state: string
          subject_id?: string | null
          worker_job_id: string
        }
        Update: {
          cohort_id?: string | null
          created_at?: string
          id?: string
          source_revision?: number
          state?: string
          subject_id?: string | null
          worker_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_source_rows_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_source_rows_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_source_rows_worker_job_id_fkey"
            columns: ["worker_job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      portrait_results: {
        Row: {
          computation_revision: number
          computed_at: string
          coverage: number
          family_pair_id: string
          id: string
          kind: string
          method_version: string
          owner_account_id: string
          parent_a_subject_id: string
          parent_b_subject_id: string
          result: Json
          source_binding_fingerprint: string
          trait_key: string
        }
        Insert: {
          computation_revision: number
          computed_at?: string
          coverage: number
          family_pair_id: string
          id?: string
          kind: string
          method_version: string
          owner_account_id: string
          parent_a_subject_id: string
          parent_b_subject_id: string
          result: Json
          source_binding_fingerprint: string
          trait_key: string
        }
        Update: {
          computation_revision?: number
          computed_at?: string
          coverage?: number
          family_pair_id?: string
          id?: string
          kind?: string
          method_version?: string
          owner_account_id?: string
          parent_a_subject_id?: string
          parent_b_subject_id?: string
          result?: Json
          source_binding_fingerprint?: string
          trait_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "portrait_results_family_pair_id_fkey"
            columns: ["family_pair_id"]
            isOneToOne: false
            referencedRelation: "family_pairs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portrait_results_parent_a_subject_id_fkey"
            columns: ["parent_a_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portrait_results_parent_b_subject_id_fkey"
            columns: ["parent_b_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_revision: number
          auth_session_revision: number
          created_at: string
          deletion_requested_at: string | null
          digest_opt_in: boolean
          display_name: string | null
          id: string
          jurisdiction_code: string | null
          jurisdiction_revision: number
          non_self_upload_suspended_at: string | null
        }
        Insert: {
          account_revision?: number
          auth_session_revision?: number
          created_at?: string
          deletion_requested_at?: string | null
          digest_opt_in?: boolean
          display_name?: string | null
          id: string
          jurisdiction_code?: string | null
          jurisdiction_revision?: number
          non_self_upload_suspended_at?: string | null
        }
        Update: {
          account_revision?: number
          auth_session_revision?: number
          created_at?: string
          deletion_requested_at?: string | null
          digest_opt_in?: boolean
          display_name?: string | null
          id?: string
          jurisdiction_code?: string | null
          jurisdiction_revision?: number
          non_self_upload_suspended_at?: string | null
        }
        Relationships: []
      }
      provider_recipient_grants: {
        Row: {
          account_id: string
          artifact_key: string
          artifact_version: number
          created_at: string
          ended_at: string | null
          grant_revision: number
          id: string
          model_recipient_revision: number
          provider_id: string
          purpose: string
          recipient_principal_id: string
          status: string
        }
        Insert: {
          account_id: string
          artifact_key: string
          artifact_version: number
          created_at?: string
          ended_at?: string | null
          grant_revision: number
          id?: string
          model_recipient_revision: number
          provider_id: string
          purpose: string
          recipient_principal_id: string
          status?: string
        }
        Update: {
          account_id?: string
          artifact_key?: string
          artifact_version?: number
          created_at?: string
          ended_at?: string | null
          grant_revision?: number
          id?: string
          model_recipient_revision?: number
          provider_id?: string
          purpose?: string
          recipient_principal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_recipient_grants_artifact_key_artifact_version_fkey"
            columns: ["artifact_key", "artifact_version"]
            isOneToOne: false
            referencedRelation: "consent_artifacts"
            referencedColumns: ["artifact_key", "version"]
          },
          {
            foreignKeyName: "provider_recipient_grants_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "provider_recipient_grants_purpose_fkey"
            columns: ["purpose"]
            isOneToOne: false
            referencedRelation: "consent_purposes"
            referencedColumns: ["purpose"]
          },
          {
            foreignKeyName: "provider_recipient_grants_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          affiliate: boolean
          checkout_url: string
          data_practices_note: string | null
          gating: string | null
          last_verified_at: string
          name: string
          privacy_policy_url: string | null
          products: Json
          raw_formats: string[]
          shipping: Json
          ships_to: string
          slug: string
          source_urls: string[]
          status: string
          turnaround: string | null
          us_state_exclusion_notes: string[]
          us_state_exclusions: string[]
          verification_summary: string | null
          website: string
        }
        Insert: {
          affiliate?: boolean
          checkout_url: string
          data_practices_note?: string | null
          gating?: string | null
          last_verified_at: string
          name: string
          privacy_policy_url?: string | null
          products?: Json
          raw_formats?: string[]
          shipping?: Json
          ships_to: string
          slug: string
          source_urls?: string[]
          status?: string
          turnaround?: string | null
          us_state_exclusion_notes?: string[]
          us_state_exclusions?: string[]
          verification_summary?: string | null
          website: string
        }
        Update: {
          affiliate?: boolean
          checkout_url?: string
          data_practices_note?: string | null
          gating?: string | null
          last_verified_at?: string
          name?: string
          privacy_policy_url?: string | null
          products?: Json
          raw_formats?: string[]
          shipping?: Json
          ships_to?: string
          slug?: string
          source_urls?: string[]
          status?: string
          turnaround?: string | null
          us_state_exclusion_notes?: string[]
          us_state_exclusions?: string[]
          verification_summary?: string | null
          website?: string
        }
        Relationships: []
      }
      prs_scores: {
        Row: {
          ancestry_note: string
          citation: Json
          n_variants: number
          name: string
          percentile_ref: Json | null
          pgs_id: string
          source_url: string
          trait: string
          updated_at: string
        }
        Insert: {
          ancestry_note: string
          citation: Json
          n_variants: number
          name: string
          percentile_ref?: Json | null
          pgs_id: string
          source_url: string
          trait: string
          updated_at?: string
        }
        Update: {
          ancestry_note?: string
          citation?: Json
          n_variants?: number
          name?: string
          percentile_ref?: Json | null
          pgs_id?: string
          source_url?: string
          trait?: string
          updated_at?: string
        }
        Relationships: []
      }
      prs_weights: {
        Row: {
          chrom: number
          effect_allele: string
          other_allele: string | null
          pgs_id: string
          pos38: number
          rsid: number | null
          weight: number
        }
        Insert: {
          chrom: number
          effect_allele: string
          other_allele?: string | null
          pgs_id: string
          pos38: number
          rsid?: number | null
          weight: number
        }
        Update: {
          chrom?: number
          effect_allele?: string
          other_allele?: string | null
          pgs_id?: string
          pos38?: number
          rsid?: number | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "prs_weights_pgs_id_fkey"
            columns: ["pgs_id"]
            isOneToOne: false
            referencedRelation: "prs_scores"
            referencedColumns: ["pgs_id"]
          },
        ]
      }
      purge_manifest_class_targets: {
        Row: {
          manifest_class: string
          target_id: string
        }
        Insert: {
          manifest_class: string
          target_id: string
        }
        Update: {
          manifest_class?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purge_manifest_class_targets_manifest_class_fkey"
            columns: ["manifest_class"]
            isOneToOne: false
            referencedRelation: "purge_manifest_classes"
            referencedColumns: ["manifest_class"]
          },
          {
            foreignKeyName: "purge_manifest_class_targets_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "purge_targets"
            referencedColumns: ["target_id"]
          },
        ]
      }
      purge_manifest_classes: {
        Row: {
          manifest_class: string
        }
        Insert: {
          manifest_class: string
        }
        Update: {
          manifest_class?: string
        }
        Relationships: []
      }
      purge_manifest_entries: {
        Row: {
          entry_revision: number
          manifest_id: string
          object_id: string | null
          row_key: Json | null
          status: string
          store_name: string
          target_id: string
        }
        Insert: {
          entry_revision: number
          manifest_id: string
          object_id?: string | null
          row_key?: Json | null
          status?: string
          store_name: string
          target_id: string
        }
        Update: {
          entry_revision?: number
          manifest_id?: string
          object_id?: string | null
          row_key?: Json | null
          status?: string
          store_name?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purge_manifest_entries_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "purge_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purge_manifest_entries_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "purge_targets"
            referencedColumns: ["target_id"]
          },
          {
            foreignKeyName: "purge_manifest_entries_target_id_store_name_fkey"
            columns: ["target_id", "store_name"]
            isOneToOne: false
            referencedRelation: "purge_target_stores"
            referencedColumns: ["target_id", "store_name"]
          },
        ]
      }
      purge_manifests: {
        Row: {
          created_at: string
          id: string
          manifest_class: string
          manifest_revision: number
          phase_id: string
          phase_revision: number
          retention_row_id: string
          source_binding_fingerprint: string
          state: string
        }
        Insert: {
          created_at?: string
          id?: string
          manifest_class: string
          manifest_revision: number
          phase_id: string
          phase_revision: number
          retention_row_id: string
          source_binding_fingerprint: string
          state?: string
        }
        Update: {
          created_at?: string
          id?: string
          manifest_class?: string
          manifest_revision?: number
          phase_id?: string
          phase_revision?: number
          retention_row_id?: string
          source_binding_fingerprint?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "purge_manifests_manifest_class_fkey"
            columns: ["manifest_class"]
            isOneToOne: false
            referencedRelation: "purge_manifest_classes"
            referencedColumns: ["manifest_class"]
          },
          {
            foreignKeyName: "purge_manifests_retention_row_id_fkey"
            columns: ["retention_row_id"]
            isOneToOne: false
            referencedRelation: "retention_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purge_manifests_retention_row_id_phase_id_phase_revision_fkey"
            columns: ["retention_row_id", "phase_id", "phase_revision"]
            isOneToOne: false
            referencedRelation: "retention_due_phases"
            referencedColumns: [
              "retention_row_id",
              "phase_id",
              "phase_revision",
            ]
          },
        ]
      }
      purge_target_stores: {
        Row: {
          store_name: string
          store_order: number
          target_id: string
        }
        Insert: {
          store_name: string
          store_order: number
          target_id: string
        }
        Update: {
          store_name?: string
          store_order?: number
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purge_target_stores_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "purge_targets"
            referencedColumns: ["target_id"]
          },
        ]
      }
      purge_targets: {
        Row: {
          delete_order: number
          target_id: string
        }
        Insert: {
          delete_order: number
          target_id: string
        }
        Update: {
          delete_order?: number
          target_id?: string
        }
        Relationships: []
      }
      purpose_grants: {
        Row: {
          artifact_body_sha256: string
          artifact_key: string
          artifact_version: number
          data_subject_principal_id: string
          expires_at: string | null
          grant_id: string
          grant_revision: number
          granted_at: string
          jurisdiction_code: string
          jurisdiction_revision: number
          purpose: string
          revocation_reason: string | null
          revoked_at: string | null
          signature_id: string
          signer_principal_id: string
          subject_binding_revision: number
          target_id: string
          target_kind: string
        }
        Insert: {
          artifact_body_sha256: string
          artifact_key: string
          artifact_version: number
          data_subject_principal_id: string
          expires_at?: string | null
          grant_id?: string
          grant_revision: number
          granted_at?: string
          jurisdiction_code: string
          jurisdiction_revision: number
          purpose: string
          revocation_reason?: string | null
          revoked_at?: string | null
          signature_id: string
          signer_principal_id: string
          subject_binding_revision: number
          target_id: string
          target_kind: string
        }
        Update: {
          artifact_body_sha256?: string
          artifact_key?: string
          artifact_version?: number
          data_subject_principal_id?: string
          expires_at?: string | null
          grant_id?: string
          grant_revision?: number
          granted_at?: string
          jurisdiction_code?: string
          jurisdiction_revision?: number
          purpose?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          signature_id?: string
          signer_principal_id?: string
          subject_binding_revision?: number
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "purpose_grants_artifact_key_artifact_version_fkey"
            columns: ["artifact_key", "artifact_version"]
            isOneToOne: false
            referencedRelation: "consent_artifacts"
            referencedColumns: ["artifact_key", "version"]
          },
          {
            foreignKeyName: "purpose_grants_data_subject_principal_id_fkey"
            columns: ["data_subject_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purpose_grants_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "consent_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purpose_grants_signer_principal_id_fkey"
            columns: ["signer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hmac_buckets: {
        Row: {
          action_id: string
          blocked_until: string | null
          bucket_key_hmac: string
          expires_at: string
          hmac_key_revision: number
          limit_count: number
          request_count: number
          window_seconds: number
          window_started_at: string
        }
        Insert: {
          action_id: string
          blocked_until?: string | null
          bucket_key_hmac: string
          expires_at: string
          hmac_key_revision: number
          limit_count: number
          request_count?: number
          window_seconds: number
          window_started_at: string
        }
        Update: {
          action_id?: string
          blocked_until?: string | null
          bucket_key_hmac?: string
          expires_at?: string
          hmac_key_revision?: number
          limit_count?: number
          request_count?: number
          window_seconds?: number
          window_started_at?: string
        }
        Relationships: []
      }
      ref_genes: {
        Row: {
          chrom: number | null
          end_pos: number | null
          name: string | null
          start_pos: number | null
          summary: string | null
          symbol: string
        }
        Insert: {
          chrom?: number | null
          end_pos?: number | null
          name?: string | null
          start_pos?: number | null
          summary?: string | null
          symbol: string
        }
        Update: {
          chrom?: number | null
          end_pos?: number | null
          name?: string | null
          start_pos?: number | null
          summary?: string | null
          symbol?: string
        }
        Relationships: []
      }
      ref_region_releases: {
        Row: {
          name: string
          published_at: string
          release_id: string
          retired_at: string | null
          source_sha256: string
        }
        Insert: {
          name: string
          published_at: string
          release_id: string
          retired_at?: string | null
          source_sha256: string
        }
        Update: {
          name?: string
          published_at?: string
          release_id?: string
          retired_at?: string | null
          source_sha256?: string
        }
        Relationships: []
      }
      ref_regions: {
        Row: {
          citation_ids: string[]
          display_name: string
          level: number
          parent_region_code: string | null
          region_code: string
          release_id: string
          sort_order: number
        }
        Insert: {
          citation_ids?: string[]
          display_name: string
          level: number
          parent_region_code?: string | null
          region_code: string
          release_id: string
          sort_order: number
        }
        Update: {
          citation_ids?: string[]
          display_name?: string
          level?: number
          parent_region_code?: string | null
          region_code?: string
          release_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ref_regions_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "ref_region_releases"
            referencedColumns: ["release_id"]
          },
          {
            foreignKeyName: "ref_regions_release_id_parent_region_code_fkey"
            columns: ["release_id", "parent_region_code"]
            isOneToOne: false
            referencedRelation: "ref_regions"
            referencedColumns: ["release_id", "region_code"]
          },
        ]
      }
      ref_variants: {
        Row: {
          alt: string | null
          chrom: number
          clinvar_review_status: string | null
          clinvar_significance: string | null
          gene_symbol: string | null
          gnomad_af: number | null
          gnomad_af_by_pop: Json | null
          pos37: number | null
          pos38: number | null
          ref: string | null
          rsid: number
          sources: Json
          updated_at: string
        }
        Insert: {
          alt?: string | null
          chrom: number
          clinvar_review_status?: string | null
          clinvar_significance?: string | null
          gene_symbol?: string | null
          gnomad_af?: number | null
          gnomad_af_by_pop?: Json | null
          pos37?: number | null
          pos38?: number | null
          ref?: string | null
          rsid: number
          sources?: Json
          updated_at?: string
        }
        Update: {
          alt?: string | null
          chrom?: number
          clinvar_review_status?: string | null
          clinvar_significance?: string | null
          gene_symbol?: string | null
          gnomad_af?: number | null
          gnomad_af_by_pop?: Json | null
          pos37?: number | null
          pos38?: number | null
          ref?: string | null
          rsid?: number
          sources?: Json
          updated_at?: string
        }
        Relationships: []
      }
      report_artifacts: {
        Row: {
          artifact: Json
          cohort_id: string | null
          created_at: string
          id: string
          report_kind: string
          report_revision: number
          source_binding_fingerprint: string
          subject_id: string | null
        }
        Insert: {
          artifact: Json
          cohort_id?: string | null
          created_at?: string
          id?: string
          report_kind: string
          report_revision: number
          source_binding_fingerprint: string
          subject_id?: string | null
        }
        Update: {
          artifact?: Json
          cohort_id?: string | null
          created_at?: string
          id?: string
          report_kind?: string
          report_revision?: number
          source_binding_fingerprint?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_artifacts_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_artifacts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          category: string
          citations: Json
          created_at: string
          evidence: Database["public"]["Enums"]["evidence_level"]
          pgs_id: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["template_status"]
          summary: string
          title: string
          updated_at: string
          variants: Json
        }
        Insert: {
          category: string
          citations?: Json
          created_at?: string
          evidence: Database["public"]["Enums"]["evidence_level"]
          pgs_id?: string | null
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["template_status"]
          summary: string
          title: string
          updated_at?: string
          variants?: Json
        }
        Update: {
          category?: string
          citations?: Json
          created_at?: string
          evidence?: Database["public"]["Enums"]["evidence_level"]
          pgs_id?: string | null
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["template_status"]
          summary?: string
          title?: string
          updated_at?: string
          variants?: Json
        }
        Relationships: []
      }
      research_releases: {
        Row: {
          id: string
          processed_at: string
          release_key: string
          source: string
          summary: Json
        }
        Insert: {
          id?: string
          processed_at?: string
          release_key: string
          source: string
          summary?: Json
        }
        Update: {
          id?: string
          processed_at?: string
          release_key?: string
          source?: string
          summary?: Json
        }
        Relationships: []
      }
      retention_due_phases: {
        Row: {
          attempts: number
          claim_expires_at: string | null
          claim_token_hash: string | null
          completed_at: string | null
          disposition_revision: number
          immutable_envelope: Json
          phase_deadline: string
          phase_id: string
          phase_kind: string
          phase_revision: number
          recipient_authority_kind: string
          recipient_authority_revision: number
          retention_id: string
          retention_row_id: string
          status: string
          target_id: string
          target_kind: string
          target_lifecycle_revision: number
          terminal_outcome_code: string | null
        }
        Insert: {
          attempts?: number
          claim_expires_at?: string | null
          claim_token_hash?: string | null
          completed_at?: string | null
          disposition_revision: number
          immutable_envelope?: Json
          phase_deadline: string
          phase_id: string
          phase_kind: string
          phase_revision: number
          recipient_authority_kind: string
          recipient_authority_revision: number
          retention_id: string
          retention_row_id: string
          status?: string
          target_id: string
          target_kind: string
          target_lifecycle_revision: number
          terminal_outcome_code?: string | null
        }
        Update: {
          attempts?: number
          claim_expires_at?: string | null
          claim_token_hash?: string | null
          completed_at?: string | null
          disposition_revision?: number
          immutable_envelope?: Json
          phase_deadline?: string
          phase_id?: string
          phase_kind?: string
          phase_revision?: number
          recipient_authority_kind?: string
          recipient_authority_revision?: number
          retention_id?: string
          retention_row_id?: string
          status?: string
          target_id?: string
          target_kind?: string
          target_lifecycle_revision?: number
          terminal_outcome_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_due_phases_retention_id_phase_id_fkey"
            columns: ["retention_id", "phase_id"]
            isOneToOne: false
            referencedRelation: "retention_phase_registry"
            referencedColumns: ["retention_id", "phase_id"]
          },
          {
            foreignKeyName: "retention_due_phases_retention_row_id_fkey"
            columns: ["retention_row_id"]
            isOneToOne: false
            referencedRelation: "retention_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_notice_campaigns: {
        Row: {
          created_at: string
          id: string
          phase_id: string
          phase_revision: number
          recipient_set_revision: number
          retention_row_id: string
          state: string
        }
        Insert: {
          created_at?: string
          id?: string
          phase_id: string
          phase_revision: number
          recipient_set_revision: number
          retention_row_id: string
          state: string
        }
        Update: {
          created_at?: string
          id?: string
          phase_id?: string
          phase_revision?: number
          recipient_set_revision?: number
          retention_row_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_notice_campaigns_retention_row_id_fkey"
            columns: ["retention_row_id"]
            isOneToOne: false
            referencedRelation: "retention_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_phase_registry: {
        Row: {
          phase_id: string
          phase_kind: string
          retention_id: string
        }
        Insert: {
          phase_id: string
          phase_kind: string
          retention_id: string
        }
        Update: {
          phase_id?: string
          phase_kind?: string
          retention_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_phase_registry_retention_id_fkey"
            columns: ["retention_id"]
            isOneToOne: false
            referencedRelation: "retention_registry"
            referencedColumns: ["retention_id"]
          },
        ]
      }
      retention_registry: {
        Row: {
          execution_class: string
          retention_id: string
        }
        Insert: {
          execution_class: string
          retention_id: string
        }
        Update: {
          execution_class?: string
          retention_id?: string
        }
        Relationships: []
      }
      retention_rows: {
        Row: {
          created_at: string
          disposition_revision: number
          ended_at: string | null
          fixed_deadline: string
          id: string
          retention_id: string
          retention_revision: number
          state: string
          target_id: string
          target_kind: string
          target_lifecycle_revision: number
        }
        Insert: {
          created_at?: string
          disposition_revision: number
          ended_at?: string | null
          fixed_deadline: string
          id?: string
          retention_id: string
          retention_revision: number
          state?: string
          target_id: string
          target_kind: string
          target_lifecycle_revision: number
        }
        Update: {
          created_at?: string
          disposition_revision?: number
          ended_at?: string | null
          fixed_deadline?: string
          id?: string
          retention_id?: string
          retention_revision?: number
          state?: string
          target_id?: string
          target_kind?: string
          target_lifecycle_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "retention_rows_retention_id_fkey"
            columns: ["retention_id"]
            isOneToOne: false
            referencedRelation: "retention_registry"
            referencedColumns: ["retention_id"]
          },
        ]
      }
      reviewed_evidence: {
        Row: {
          evidence_kind: string
          evidence_revision: number
          evidence_sha256: string
          id: string
          purged_at: string | null
          received_at: string
          review_id: string
          storage_object_id: string | null
        }
        Insert: {
          evidence_kind: string
          evidence_revision: number
          evidence_sha256: string
          id?: string
          purged_at?: string | null
          received_at?: string
          review_id: string
          storage_object_id?: string | null
        }
        Update: {
          evidence_kind?: string
          evidence_revision?: number
          evidence_sha256?: string
          id?: string
          purged_at?: string | null
          received_at?: string
          review_id?: string
          storage_object_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviewed_evidence_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "legal_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_nonces: {
        Row: {
          consumed_at: string | null
          expires_at: string
          nonce_hash: string
          nonce_revision: number
          rights_session_id: string
        }
        Insert: {
          consumed_at?: string | null
          expires_at: string
          nonce_hash: string
          nonce_revision: number
          rights_session_id: string
        }
        Update: {
          consumed_at?: string | null
          expires_at?: string
          nonce_hash?: string
          nonce_revision?: number
          rights_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_nonces_rights_session_id_fkey"
            columns: ["rights_session_id"]
            isOneToOne: false
            referencedRelation: "rights_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rights_sessions: {
        Row: {
          authority_revision: number
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          principal_id: string
          purpose: string
          session_hash: string
          status: string
          target_id: string
          target_kind: string
          token_hash_id: string
        }
        Insert: {
          authority_revision: number
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          principal_id: string
          purpose: string
          session_hash: string
          status?: string
          target_id: string
          target_kind: string
          token_hash_id: string
        }
        Update: {
          authority_revision?: number
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          principal_id?: string
          purpose?: string
          session_hash?: string
          status?: string
          target_id?: string
          target_kind?: string
          token_hash_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_sessions_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rights_sessions_token_hash_id_fkey"
            columns: ["token_hash_id"]
            isOneToOne: false
            referencedRelation: "token_hashes"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_models: {
        Row: {
          age_band: string
          baseline_high: number
          baseline_low: number
          baseline_point: number
          birth_cohort: string
          calibration_cohort: string
          calibration_n: number
          condition_id: string
          enabled: boolean
          model_id: string
          model_revision: number
          model_version: string
          prevalence_basis: string
          sex_basis: string
          subject_class: string
          within_family_status: string
        }
        Insert: {
          age_band: string
          baseline_high: number
          baseline_low: number
          baseline_point: number
          birth_cohort: string
          calibration_cohort: string
          calibration_n: number
          condition_id: string
          enabled?: boolean
          model_id: string
          model_revision: number
          model_version: string
          prevalence_basis: string
          sex_basis: string
          subject_class: string
          within_family_status: string
        }
        Update: {
          age_band?: string
          baseline_high?: number
          baseline_low?: number
          baseline_point?: number
          birth_cohort?: string
          calibration_cohort?: string
          calibration_n?: number
          condition_id?: string
          enabled?: boolean
          model_id?: string
          model_revision?: number
          model_version?: string
          prevalence_basis?: string
          sex_basis?: string
          subject_class?: string
          within_family_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_models_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "condition_registry"
            referencedColumns: ["condition_id"]
          },
        ]
      }
      subject_account_bindings: {
        Row: {
          account_id: string
          account_principal_id: string
          binding_kind: string
          binding_revision: number
          bound_at: string
          ended_at: string | null
          id: string
          status: string
          subject_id: string
          subject_principal_id: string
        }
        Insert: {
          account_id: string
          account_principal_id: string
          binding_kind: string
          binding_revision: number
          bound_at?: string
          ended_at?: string | null
          id?: string
          status: string
          subject_id: string
          subject_principal_id: string
        }
        Update: {
          account_id?: string
          account_principal_id?: string
          binding_kind?: string
          binding_revision?: number
          bound_at?: string
          ended_at?: string | null
          id?: string
          status?: string
          subject_id?: string
          subject_principal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_account_bindings_account_principal_id_fkey"
            columns: ["account_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_account_bindings_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_account_bindings_subject_principal_id_fkey"
            columns: ["subject_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_consents: {
        Row: {
          account_id: string | null
          cohort_id: string | null
          consent_type: string
          expires_at: string | null
          grant_revision: number
          granted_at: string
          id: string
          provider_key: string | null
          revocation_reason: string | null
          revoked_at: string | null
          scope: string[]
          signature_id: string
          subject_id: string | null
        }
        Insert: {
          account_id?: string | null
          cohort_id?: string | null
          consent_type: string
          expires_at?: string | null
          grant_revision?: number
          granted_at?: string
          id?: string
          provider_key?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          scope: string[]
          signature_id: string
          subject_id?: string | null
        }
        Update: {
          account_id?: string | null
          cohort_id?: string | null
          consent_type?: string
          expires_at?: string | null
          grant_revision?: number
          granted_at?: string
          id?: string
          provider_key?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          scope?: string[]
          signature_id?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subject_consents_cohort_fk"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_consents_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "consent_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_consents_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_control_refusal_authorities: {
        Row: {
          authority_revision: number
          created_at: string
          id: string
          principal_id: string
          status: string
          subject_id: string
        }
        Insert: {
          authority_revision: number
          created_at?: string
          id?: string
          principal_id: string
          status: string
          subject_id: string
        }
        Update: {
          authority_revision?: number
          created_at?: string
          id?: string
          principal_id?: string
          status?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_control_refusal_authorities_principal_id_fkey"
            columns: ["principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_control_refusal_authorities_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_demographics: {
        Row: {
          chromosomal_sex: string | null
          date_of_birth: string | null
          demographics_revision: number
          subject_id: string
          updated_at: string
        }
        Insert: {
          chromosomal_sex?: string | null
          date_of_birth?: string | null
          demographics_revision?: number
          subject_id: string
          updated_at?: string
        }
        Update: {
          chromosomal_sex?: string | null
          date_of_birth?: string | null
          demographics_revision?: number
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_demographics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: true
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_invitations: {
        Row: {
          accepted_at: string | null
          contact_purge_due_at: string | null
          created_at: string
          email_encrypted: string | null
          email_hmac: string
          expires_at: string
          id: string
          invitation_kind: string
          invitation_revision: number
          invitee_principal_id: string | null
          inviter_principal_id: string
          status: string
          target_id: string
          target_kind: string
          terminal_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          contact_purge_due_at?: string | null
          created_at?: string
          email_encrypted?: string | null
          email_hmac: string
          expires_at: string
          id?: string
          invitation_kind: string
          invitation_revision?: number
          invitee_principal_id?: string | null
          inviter_principal_id: string
          status?: string
          target_id: string
          target_kind: string
          terminal_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          contact_purge_due_at?: string | null
          created_at?: string
          email_encrypted?: string | null
          email_hmac?: string
          expires_at?: string
          id?: string
          invitation_kind?: string
          invitation_revision?: number
          invitee_principal_id?: string | null
          inviter_principal_id?: string
          status?: string
          target_id?: string
          target_kind?: string
          terminal_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_invitations_invitee_principal_id_fkey"
            columns: ["invitee_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_invitations_inviter_principal_id_fkey"
            columns: ["inviter_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_principals: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          principal_kind: string
          principal_revision: number
          status: string
          subject_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          principal_kind: string
          principal_revision?: number
          status?: string
          subject_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          principal_kind?: string
          principal_revision?: number
          status?: string
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subject_principals_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_relationships: {
        Row: {
          created_at: string
          data_subject_principal_id: string
          ended_at: string | null
          id: string
          recipient_account_id: string | null
          recipient_principal_id: string
          relationship_kind: string
          relationship_revision: number
          status: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          data_subject_principal_id: string
          ended_at?: string | null
          id?: string
          recipient_account_id?: string | null
          recipient_principal_id: string
          relationship_kind: string
          relationship_revision: number
          status?: string
          subject_id: string
        }
        Update: {
          created_at?: string
          data_subject_principal_id?: string
          ended_at?: string | null
          id?: string
          recipient_account_id?: string | null
          recipient_principal_id?: string
          relationship_kind?: string
          relationship_revision?: number
          status?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subject_relationships_data_subject_principal_id_fkey"
            columns: ["data_subject_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_relationships_recipient_principal_id_fkey"
            columns: ["recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subject_relationships_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          cohort_id: string | null
          created_at: string
          display_label: string
          id: string
          lifecycle: string
          lifecycle_revision: number
          owner_account_id: string | null
          subject_account_id: string | null
          subject_binding_revision: number
          subject_class: string
          updated_at: string
          upload_class: string
        }
        Insert: {
          cohort_id?: string | null
          created_at?: string
          display_label: string
          id?: string
          lifecycle?: string
          lifecycle_revision?: number
          owner_account_id?: string | null
          subject_account_id?: string | null
          subject_binding_revision?: number
          subject_class: string
          updated_at?: string
          upload_class: string
        }
        Update: {
          cohort_id?: string | null
          created_at?: string
          display_label?: string
          id?: string
          lifecycle?: string
          lifecycle_revision?: number
          owner_account_id?: string | null
          subject_account_id?: string | null
          subject_binding_revision?: number
          subject_class?: string
          updated_at?: string
          upload_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressions: {
        Row: {
          active_from: string
          condition_id: string
          ended_at: string | null
          id: string
          reason_code: string
          subject_id: string
          suppression_revision: number
        }
        Insert: {
          active_from?: string
          condition_id: string
          ended_at?: string | null
          id?: string
          reason_code: string
          subject_id: string
          suppression_revision: number
        }
        Update: {
          active_from?: string
          condition_id?: string
          ended_at?: string | null
          id?: string
          reason_code?: string
          subject_id?: string
          suppression_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "suppressions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      template_reviews: {
        Row: {
          decided_at: string
          decision: string
          evidence_review_due: string
          id: string
          review_revision: number
          reviewer_principal_id: string
          template_id: string
        }
        Insert: {
          decided_at?: string
          decision: string
          evidence_review_due: string
          id?: string
          review_revision: number
          reviewer_principal_id: string
          template_id: string
        }
        Update: {
          decided_at?: string
          decision?: string
          evidence_review_due?: string
          id?: string
          review_revision?: number
          reviewer_principal_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_reviews_reviewer_principal_id_fkey"
            columns: ["reviewer_principal_id"]
            isOneToOne: false
            referencedRelation: "subject_principals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_reviews_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["slug"]
          },
        ]
      }
      token_candidates: {
        Row: {
          expires_at: string
          id: string
          outbox_id: string
          purpose: string
          state: string
          target_id: string
          target_kind: string
          token_revision: number
        }
        Insert: {
          expires_at: string
          id?: string
          outbox_id: string
          purpose: string
          state?: string
          target_id: string
          target_kind: string
          token_revision: number
        }
        Update: {
          expires_at?: string
          id?: string
          outbox_id?: string
          purpose?: string
          state?: string
          target_id?: string
          target_kind?: string
          token_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "token_candidates_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "mail_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      token_hashes: {
        Row: {
          candidate_id: string
          created_at: string
          ended_at: string | null
          id: string
          status: string
          token_hash: string
          token_revision: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          status?: string
          token_hash: string
          token_revision: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          status?: string
          token_hash?: string
          token_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "token_hashes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "token_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_chunks: {
        Row: {
          byte_count: number
          chunk_ordinal: number
          content_sha256: string
          created_at: string
          object_id: string
          upload_session_id: string
        }
        Insert: {
          byte_count: number
          chunk_ordinal: number
          content_sha256: string
          created_at?: string
          object_id: string
          upload_session_id: string
        }
        Update: {
          byte_count?: number
          chunk_ordinal?: number
          content_sha256?: string
          created_at?: string
          object_id?: string
          upload_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_chunks_upload_session_id_fkey"
            columns: ["upload_session_id"]
            isOneToOne: false
            referencedRelation: "upload_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_sessions: {
        Row: {
          account_id: string
          auth_session_id: string
          cohort_id: string | null
          consumed_at: string | null
          content_type: string
          created_at: string
          expected_sha256: string
          expected_size: number
          expires_at: string
          id: string
          staging_object_name: string
          status: string
          subject_id: string | null
          upload_revision: number
        }
        Insert: {
          account_id: string
          auth_session_id: string
          cohort_id?: string | null
          consumed_at?: string | null
          content_type: string
          created_at?: string
          expected_sha256: string
          expected_size: number
          expires_at: string
          id?: string
          staging_object_name: string
          status?: string
          subject_id?: string | null
          upload_revision: number
        }
        Update: {
          account_id?: string
          auth_session_id?: string
          cohort_id?: string | null
          consumed_at?: string | null
          content_type?: string
          created_at?: string
          expected_sha256?: string
          expected_size?: number
          expires_at?: string
          id?: string
          staging_object_name?: string
          status?: string
          subject_id?: string | null
          upload_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "upload_sessions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_staging_objects: {
        Row: {
          created_at: string
          object_id: string
          object_name: string
          state: string
          upload_session_id: string
        }
        Insert: {
          created_at?: string
          object_id: string
          object_name: string
          state: string
          upload_session_id: string
        }
        Update: {
          created_at?: string
          object_id?: string
          object_name?: string
          state?: string
          upload_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_staging_objects_upload_session_id_fkey"
            columns: ["upload_session_id"]
            isOneToOne: true
            referencedRelation: "upload_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_prs: {
        Row: {
          computed_at: string
          coverage: number
          file_id: string
          id: string
          matched: number
          percentile: number | null
          pgs_id: string
          raw_score: number
          subject_id: string
          user_id: string
          zscore: number | null
        }
        Insert: {
          computed_at?: string
          coverage: number
          file_id: string
          id?: string
          matched: number
          percentile?: number | null
          pgs_id: string
          raw_score: number
          subject_id: string
          user_id: string
          zscore?: number | null
        }
        Update: {
          computed_at?: string
          coverage?: number
          file_id?: string
          id?: string
          matched?: number
          percentile?: number | null
          pgs_id?: string
          raw_score?: number
          subject_id?: string
          user_id?: string
          zscore?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_prs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_prs_pgs_id_fkey"
            columns: ["pgs_id"]
            isOneToOne: false
            referencedRelation: "prs_scores"
            referencedColumns: ["pgs_id"]
          },
          {
            foreignKeyName: "user_prs_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_variants: {
        Row: {
          alt: string | null
          chrom: number
          file_id: string
          genotype: string
          id: number
          pos: number
          ref: string | null
          rsid: number | null
          subject_id: string
          user_id: string
        }
        Insert: {
          alt?: string | null
          chrom: number
          file_id: string
          genotype: string
          id?: never
          pos: number
          ref?: string | null
          rsid?: number | null
          subject_id: string
          user_id: string
        }
        Update: {
          alt?: string | null
          chrom?: number
          file_id?: string
          genotype?: string
          id?: never
          pos?: number
          ref?: string | null
          rsid?: number | null
          subject_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_variants_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_variants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_job_batches: {
        Row: {
          batch_ordinal: number
          claim_revision: number
          completed_at: string | null
          status: string
          worker_job_id: string
        }
        Insert: {
          batch_ordinal: number
          claim_revision: number
          completed_at?: string | null
          status: string
          worker_job_id: string
        }
        Update: {
          batch_ordinal?: number
          claim_revision?: number
          completed_at?: string | null
          status?: string
          worker_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_job_batches_worker_job_id_fkey"
            columns: ["worker_job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_jobs: {
        Row: {
          attempts: number
          claim_expires_at: string | null
          claim_token_hash: string | null
          claimed_by: string | null
          cohort_id: string | null
          computation_revision: string
          created_at: string
          error: string | null
          file_id: string | null
          file_sha256: string
          finished_at: string | null
          id: string
          idempotency_key: string
          kind: string
          max_attempts: number
          not_before: string
          output_kind: string
          partial: boolean
          payload: Json
          progress: number
          progress_note: string | null
          result: Json | null
          source_binding_id: string
          source_binding_kind: string
          source_binding_revision: number
          started_at: string | null
          status: string
          subject_id: string | null
          target_kind: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          claim_expires_at?: string | null
          claim_token_hash?: string | null
          claimed_by?: string | null
          cohort_id?: string | null
          computation_revision: string
          created_at?: string
          error?: string | null
          file_id?: string | null
          file_sha256: string
          finished_at?: string | null
          id?: string
          idempotency_key: string
          kind: string
          max_attempts?: number
          not_before?: string
          output_kind: string
          partial?: boolean
          payload?: Json
          progress?: number
          progress_note?: string | null
          result?: Json | null
          source_binding_id: string
          source_binding_kind: string
          source_binding_revision: number
          started_at?: string | null
          status?: string
          subject_id?: string | null
          target_kind?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          claim_expires_at?: string | null
          claim_token_hash?: string | null
          claimed_by?: string | null
          cohort_id?: string | null
          computation_revision?: string
          created_at?: string
          error?: string | null
          file_id?: string | null
          file_sha256?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          max_attempts?: number
          not_before?: string
          output_kind?: string
          partial?: boolean
          payload?: Json
          progress?: number
          progress_note?: string | null
          result?: Json | null
          source_binding_id?: string
          source_binding_kind?: string
          source_binding_revision?: number
          started_at?: string | null
          status?: string
          subject_id?: string | null
          target_kind?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_jobs_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "embryo_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_jobs_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_account_deletion_v1: {
        Args: {
          p_account_id: string
          p_nonce_hash: string
          p_notice_idempotency_key: string
          p_session_id: string
        }
        Returns: {
          cancelled_at: string
          status: string
        }[]
      }
      claim_mail_outbox: {
        Args: never
        Returns: {
          attempt_ordinal: number
          contact_ciphertext: string
          idempotency_key: string
          outbox_id: string
          template_id: string
          template_payload: Json
        }[]
      }
      complete_mail_attempt: {
        Args: {
          p_attempt_ordinal: number
          p_outbox_id: string
          p_outcome_code: string
          p_provider_message_id_hmac: string
          p_success: boolean
        }
        Returns: undefined
      }
      complete_upload_session: {
        Args: {
          p_account_id: string
          p_auth_session_id: string
          p_file_type: string
          p_original_name: string
          p_storage_object_id: string
          p_tier: number
          p_upload_session_id: string
        }
        Returns: string
      }
      enqueue_account_mail: {
        Args: {
          p_account_id: string
          p_contact_ciphertext: string
          p_contact_hmac: string
          p_expires_at: string
          p_idempotency_key: string
          p_purpose: string
          p_target_id: string
          p_target_kind: string
          p_template_id: string
          p_template_payload: Json
        }
        Returns: string
      }
      grant_cloud_model_consent: {
        Args: {
          p_account_id: string
          p_data_classes: string[]
          p_provider_key: string
        }
        Returns: string
      }
      issue_account_operation_nonce_v1: {
        Args: {
          p_account_id: string
          p_expires_at: string
          p_nonce_hash: string
          p_operation: string
          p_session_id: string
        }
        Returns: undefined
      }
      processing_time_stats: {
        Args: never
        Returns: {
          file_tier: number
          n: number
          p50_seconds: number
          p95_seconds: number
        }[]
      }
      record_resend_mail_event: {
        Args: {
          p_occurred_at: string
          p_provider_event_hmac: string
          p_provider_message_id_hmac: string
          p_status: string
        }
        Returns: boolean
      }
      request_account_deletion_v1: {
        Args: {
          p_account_id: string
          p_contact_ciphertext: string
          p_contact_hmac: string
          p_nonce_hash: string
          p_notice_idempotency_key: string
          p_session_id: string
        }
        Returns: {
          deletion_id: string
          notice_ends_at: string
          status: string
        }[]
      }
      revoke_cloud_model_consent: {
        Args: { p_account_id: string; p_grant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      evidence_level: "established" | "moderate" | "preliminary"
      genome_file_status:
        | "uploading"
        | "uploaded"
        | "parsing"
        | "parsed"
        | "annotated"
        | "failed"
        | "stored"
      genome_file_type:
        | "array_23andme"
        | "array_ancestry"
        | "array_myheritage"
        | "array_ftdna"
        | "vcf"
        | "gvcf"
        | "bam"
        | "cram"
        | "vcf_multisample"
        | "pgt_table"
      template_status: "draft" | "review" | "published" | "retired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      evidence_level: ["established", "moderate", "preliminary"],
      genome_file_status: [
        "uploading",
        "uploaded",
        "parsing",
        "parsed",
        "annotated",
        "failed",
        "stored",
      ],
      genome_file_type: [
        "array_23andme",
        "array_ancestry",
        "array_myheritage",
        "array_ftdna",
        "vcf",
        "gvcf",
        "bam",
        "cram",
        "vcf_multisample",
        "pgt_table",
      ],
      template_status: ["draft", "review", "published", "retired"],
    },
  },
} as const

