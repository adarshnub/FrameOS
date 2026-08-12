import { EventEmitter } from "node:events";
import { createId } from "@frameos/contracts";

export interface FrameOSEvent<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  projectId?: string;
  payload: T;
}

export class EventBus {
  private readonly emitter = new EventEmitter();

  public publish<T>(
    type: string,
    payload: T,
    projectId?: string,
  ): FrameOSEvent<T> {
    const event: FrameOSEvent<T> = {
      id: createId(),
      type,
      occurredAt: new Date().toISOString(),
      ...(projectId === undefined ? {} : { projectId }),
      payload,
    };
    this.emitter.emit("event", event);
    return event;
  }

  public subscribe(listener: (event: FrameOSEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
