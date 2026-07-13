import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canManageTickets,
  TICKET_STATUSES,
  validateTicketTransition,
  type TicketStatus,
} from "@/lib/tickets/ticket-workflow";

const UpdateTicketStatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(TICKET_STATUSES),
  resolutionNote: z.string().trim().max(1200).nullable().optional(),
});

async function getCurrentUserRoles(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);

  if (error) {
    throw new Error(`No se pudieron consultar los permisos: ${error.message}`);
  }

  return (data || []).map((row: { role: string }) => row.role);
}

export const listTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const roles = await getCurrentUserRoles(supabase, userId);
    const canManage = canManageTickets(roles);

    let query = supabase
      .from("tickets")
      .select(
        "id, user_id, category, priority, summary, context_json, conversation_json, status, assigned_to, resolution_note, created_at, updated_at, resolved_at",
      )
      .order("created_at", { ascending: false });

    if (!canManage) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`No se pudieron cargar los casos: ${error.message}`);
    }

    return {
      tickets: data || [],
      canManage,
      roles,
      currentUserId: userId,
    };
  });

export const updateTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => UpdateTicketStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const roles = await getCurrentUserRoles(supabase, userId);

    if (!canManageTickets(roles)) {
      throw new Error("Solo un agente o administrador puede gestionar casos.");
    }

    const { data: ticket, error: readError } = await supabase
      .from("tickets")
      .select("id, status")
      .eq("id", data.ticketId)
      .single();

    if (readError || !ticket) {
      throw new Error(readError?.message || "No se encontró el caso.");
    }

    const currentStatus = ticket.status as TicketStatus;
    const nextStatus = data.status;

    const validation = validateTicketTransition({
      currentStatus,
      nextStatus,
      resolutionNote: data.resolutionNote,
    });

    if (!validation.ok) {
      throw new Error(validation.message);
    }

    const now = new Date().toISOString();
    const resolutionNote = data.resolutionNote?.trim() || null;

    const changes = {
      status: nextStatus,
      assigned_to: nextStatus === "PENDING_HUMAN_REVIEW" ? null : userId,
      resolution_note: nextStatus === "RESOLVED" ? resolutionNote : null,
      resolved_at: nextStatus === "RESOLVED" ? now : null,
      updated_at: now,
    };

    const { data: updated, error: updateError } = await supabase
      .from("tickets")
      .update(changes)
      .eq("id", data.ticketId)
      .eq("status", currentStatus)
      .select(
        "id, user_id, category, priority, summary, context_json, conversation_json, status, assigned_to, resolution_note, created_at, updated_at, resolved_at",
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(`No se pudo actualizar el caso: ${updateError.message}`);
    }

    if (!updated) {
      throw new Error(
        "El caso cambió mientras lo revisabas. Actualiza la bandeja e inténtalo otra vez.",
      );
    }

    return { ticket: updated };
  });
