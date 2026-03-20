import Database from 'better-sqlite3';
import { BasePlugin } from '../core/basePlugin';

export async function run(plugins: BasePlugin[], db: Database.Database): Promise<void> {
  for (const plugin of plugins) {
    const count = await plugin.collect(db);
    console.info(`Plugin '${plugin.name}' collected ${count} new item(s).`);
  }
}
