import { EventEmitter } from "node:events";

/** Nomes dos eventos publicados para o frontend (mesmos nomes do Socket.IO). */
export type OfficeEventName =
  | "agent:updated"
  | "agent:status_changed"
  | "agent:task_assigned"
  | "agent:task_started"
  | "agent:task_progress"
  | "agent:task_completed"
  | "agent:task_failed"
  | "task:created"
  | "task:queued"
  | "task:started"
  | "task:progress"
  | "task:paused"
  | "task:completed"
  | "task:failed"
  | "task:cancelled"
  | "office:notification"
  | "whatsapp:status"
  | "whatsapp:qr"
  | "message:new"
  | "message:updated"
  | "notification:new"
  | "team:updated";

export interface OfficeEvent {
  organizationId: string;
  name: OfficeEventName;
  payload: Record<string, unknown>;
}

/**
 * OfficeEventService: barramento interno. Serviços publicam aqui sem conhecer o transporte;
 * o gateway Socket.IO repassa para a sala da organização. Nos testes, basta escutar o emitter.
 */
class OfficeEventBus extends EventEmitter {
  publish(organizationId: string, name: OfficeEventName, payload: Record<string, unknown>) {
    this.emit("event", { organizationId, name, payload } satisfies OfficeEvent);
  }
}

export const officeEvents = new OfficeEventBus();
officeEvents.setMaxListeners(50);
