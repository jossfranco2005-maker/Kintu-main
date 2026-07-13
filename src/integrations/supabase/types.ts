export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      alerts: {
        Row: {
          acknowledged: boolean;
          budget_id: string;
          created_at: string;
          id: string;
          level: string;
          message: string;
          percentage: number;
          user_id: string;
        };
        Insert: {
          acknowledged?: boolean;
          budget_id: string;
          created_at?: string;
          id?: string;
          level: string;
          message: string;
          percentage: number;
          user_id: string;
        };
        Update: {
          acknowledged?: boolean;
          budget_id?: string;
          created_at?: string;
          id?: string;
          level?: string;
          message?: string;
          percentage?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_budget_id_fkey";
            columns: ["budget_id"];
            isOneToOne: false;
            referencedRelation: "budgets";
            referencedColumns: ["id"];
          },
        ];
      };
      budgets: {
        Row: {
          alert_threshold: number;
          category: string;
          created_at: string;
          id: string;
          limit_amount: number;
          month: string;
          user_id: string;
        };
        Insert: {
          alert_threshold?: number;
          category: string;
          created_at?: string;
          id?: string;
          limit_amount: number;
          month: string;
          user_id: string;
        };
        Update: {
          alert_threshold?: number;
          category?: string;
          created_at?: string;
          id?: string;
          limit_amount?: number;
          month?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          channel: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          channel?: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      knowledge_articles: {
        Row: {
          approved: boolean;
          category: string;
          content: string;
          id: string;
          source: string;
          title: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          approved?: boolean;
          category: string;
          content: string;
          id?: string;
          source?: string;
          title: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          approved?: boolean;
          category?: string;
          content?: string;
          id?: string;
          source?: string;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          role: string;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          event_key: string | null;
          id: string;
          level: string;
          message: string;
          metadata: Json;
          read_at: string | null;
          related_alert_id: string | null;
          related_ticket_id: string | null;
          related_transaction_id: string | null;
          source: string;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_key?: string | null;
          id?: string;
          level?: string;
          message: string;
          metadata?: Json;
          read_at?: string | null;
          related_alert_id?: string | null;
          related_ticket_id?: string | null;
          related_transaction_id?: string | null;
          source: string;
          title: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_key?: string | null;
          id?: string;
          level?: string;
          message?: string;
          metadata?: Json;
          read_at?: string | null;
          related_alert_id?: string | null;
          related_ticket_id?: string | null;
          related_transaction_id?: string | null;
          source?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_related_alert_id_fkey";
            columns: ["related_alert_id"];
            isOneToOne: false;
            referencedRelation: "alerts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_related_ticket_id_fkey";
            columns: ["related_ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_related_transaction_id_fkey";
            columns: ["related_transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          telegram_chat_id: number | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          telegram_chat_id?: number | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          telegram_chat_id?: number | null;
        };
        Relationships: [];
      };
      telegram_link_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          token: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          token: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          token?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      tickets: {
        Row: {
          assigned_to: string | null;
          category: string;
          context_json: Json;
          conversation_json: Json;
          created_at: string;
          id: string;
          priority: string;
          resolution_note: string | null;
          resolved_at: string | null;
          status: string;
          summary: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assigned_to?: string | null;
          category: string;
          context_json?: Json;
          conversation_json?: Json;
          created_at?: string;
          id?: string;
          priority?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          status?: string;
          summary: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          context_json?: Json;
          conversation_json?: Json;
          created_at?: string;
          id?: string;
          priority?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          status?: string;
          summary?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      transaction_drafts: {
        Row: {
          amount: number | null;
          cancelled_at: string | null;
          category: string | null;
          confirmed_at: string | null;
          conversation_id: string;
          created_at: string;
          currency: string;
          date: string | null;
          description: string | null;
          id: string;
          merchant: string | null;
          missing_fields: string[];
          status: string;
          transaction_id: string | null;
          type: Database["public"]["Enums"]["tx_type"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount?: number | null;
          cancelled_at?: string | null;
          category?: string | null;
          confirmed_at?: string | null;
          conversation_id: string;
          created_at?: string;
          currency?: string;
          date?: string | null;
          description?: string | null;
          id?: string;
          merchant?: string | null;
          missing_fields?: string[];
          status?: string;
          transaction_id?: string | null;
          type: Database["public"]["Enums"]["tx_type"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number | null;
          cancelled_at?: string | null;
          category?: string | null;
          confirmed_at?: string | null;
          conversation_id?: string;
          created_at?: string;
          currency?: string;
          date?: string | null;
          description?: string | null;
          id?: string;
          merchant?: string | null;
          missing_fields?: string[];
          status?: string;
          transaction_id?: string | null;
          type?: Database["public"]["Enums"]["tx_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transaction_drafts_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transaction_drafts_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: {
          amount: number;
          category: string;
          created_at: string;
          date: string;
          description: string | null;
          id: string;
          merchant: string | null;
          source: string;
          status: string;
          type: Database["public"]["Enums"]["tx_type"];
          user_id: string;
        };
        Insert: {
          amount: number;
          category: string;
          created_at?: string;
          date?: string;
          description?: string | null;
          id?: string;
          merchant?: string | null;
          source?: string;
          status?: string;
          type: Database["public"]["Enums"]["tx_type"];
          user_id: string;
        };
        Update: {
          amount?: number;
          category?: string;
          created_at?: string;
          date?: string;
          description?: string | null;
          id?: string;
          merchant?: string | null;
          source?: string;
          status?: string;
          type?: Database["public"]["Enums"]["tx_type"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "agent" | "user";
      tx_type: "income" | "expense";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "agent", "user"],
      tx_type: ["income", "expense"],
    },
  },
} as const;
