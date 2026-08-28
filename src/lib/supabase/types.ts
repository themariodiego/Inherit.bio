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
      ancestry_results: {
        Row: {
          created_at: string
          file_id: string
          id: string
          kind: string
          result: Json
          support_note: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_id: string
          id?: string
          kind: string
          result: Json
          support_note: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_id?: string
          id?: string
          kind?: string
          result?: Json
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
        ]
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
          chat_id: string
          content: Json
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          chat_id: string
          content: Json
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          chat_id?: string
          content?: Json
          created_at?: string
          id?: string
          role?: string
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
          created_at: string
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          user_id?: string
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
      genome_files: {
        Row: {
          bucket_path: string
          build: string | null
          created_at: string
          error: string | null
          file_type: Database["public"]["Enums"]["genome_file_type"]
          id: string
          original_name: string
          processing_finished_at: string | null
          processing_started_at: string | null
          sha256: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["genome_file_status"]
          tier: number
          user_id: string
          variant_count: number | null
        }
        Insert: {
          bucket_path: string
          build?: string | null
          created_at?: string
          error?: string | null
          file_type: Database["public"]["Enums"]["genome_file_type"]
          id?: string
          original_name: string
          processing_finished_at?: string | null
          processing_started_at?: string | null
          sha256?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["genome_file_status"]
          tier: number
          user_id: string
          variant_count?: number | null
        }
        Update: {
          bucket_path?: string
          build?: string | null
          created_at?: string
          error?: string | null
          file_type?: Database["public"]["Enums"]["genome_file_type"]
          id?: string
          original_name?: string
          processing_finished_at?: string | null
          processing_started_at?: string | null
          sha256?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["genome_file_status"]
          tier?: number
          user_id?: string
          variant_count?: number | null
        }
        Relationships: []
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
      profiles: {
        Row: {
          created_at: string
          digest_opt_in: boolean
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          digest_opt_in?: boolean
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          digest_opt_in?: boolean
          display_name?: string | null
          id?: string
        }
        Relationships: []
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
        ]
      }
      worker_jobs: {
        Row: {
          created_at: string
          error: string | null
          file_id: string | null
          finished_at: string | null
          id: string
          kind: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          file_id?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          file_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "genome_files"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      processing_time_stats: {
        Args: never
        Returns: {
          file_tier: number
          n: number
          p50_seconds: number
          p95_seconds: number
        }[]
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
      ],
      template_status: ["draft", "review", "published", "retired"],
    },
  },
} as const

