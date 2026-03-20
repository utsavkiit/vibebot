import Database from 'better-sqlite3';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BasePlugin } from '../core/basePlugin';

export async function run(
  plugins: BasePlugin[],
  db: Database.Database,
  llm: BaseChatModel,
): Promise<void> {
  for (const plugin of plugins) {
    const msgId = await plugin.buildDigest(db, llm);
    if (msgId !== null) {
      console.info(`Plugin '${plugin.name}' built digest → outbound_message id=${msgId}.`);
    } else {
      console.info(`Plugin '${plugin.name}': no new items to digest.`);
    }
  }
}
