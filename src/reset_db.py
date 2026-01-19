import os
import sys
import sqlite3

# Ensure the project root is in the python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.database.db_manager import DBManager
from src.config import DB_PATH

def reset_database():
    print(f"Resetting database at {DB_PATH}...")
    
    # 1. Close any existing connections (if possible/needed, though here we just delete the file)
    # Note: If the app is running, this might fail on Windows due to file locking.
    
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
            print("  - Deleted existing database file.")
        except PermissionError:
            print("  ! Warning: Could not delete database file (locked). Attempting to drop tables instead...")
            try:
                conn = sqlite3.connect(DB_PATH)
                c = conn.cursor()
                c.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = c.fetchall()
                for (table_name,) in tables:
                    if table_name != 'sqlite_sequence':
                        c.execute(f"DROP TABLE IF EXISTS {table_name}")
                        print(f"    - Dropped table {table_name}")
                conn.commit()
                conn.close()
                print("  - All tables dropped.")
            except Exception as e_drop:
                print(f"  ! Error dropping tables: {e_drop}")
                return
        except Exception as e:
            print(f"  ! Error deleting file: {e}")
            return
            
    # Remove SHM and WAL files if they exist
    for ext in ['-shm', '-wal']:
        p = DB_PATH + ext
        if os.path.exists(p):
            try:
                os.remove(p)
                print(f"  - Deleted {ext} file.")
            except:
                pass

    # 2. Re-initialize
    try:
        db = DBManager()
        # verify
        conn = db.get_connection()
        c = conn.cursor()
        c.execute("SELECT count(*) FROM users")
        count = c.fetchone()[0]
        conn.close()
        print(f"  - Database re-initialized successfully. Admin user count: {count}")
        print("Done.")
    except Exception as e:
        print(f"  ! Error initializing database: {e}")

if __name__ == "__main__":
    reset_database()
