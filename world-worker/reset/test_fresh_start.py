"""Local-only fixture test: the explicit reset preserves schema and removes learned state."""
import json
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:')
db.executescript((ROOT/'schema.sql').read_text())
db.executescript("""
INSERT INTO documents(path,content) VALUES('note.txt','old memories');
INSERT INTO events(kind,content,action) VALUES('thought','I know about the garden','THINK');
INSERT INTO world_rewards(source_key,action,points,detail) VALUES('old:1','inspect',10,'old');
INSERT INTO object_notes(object_id,note) VALUES('well_001','known');
INSERT INTO object_observations(object_id,properties_json,comparison) VALUES('well_001','{}','first');
INSERT INTO world_seen(x,y) VALUES(10,10);
INSERT INTO world_food_inventory(fruit) VALUES('amber');
INSERT INTO world_food_memory(fruit,count,informative,mean,minimum_relief,helpful,harmful) VALUES('amber',2,2,-35,35,2,0);
INSERT INTO garden_inventory(kind) VALUES('watering_can');
UPDATE garden_plots SET planted_at=12345,watered_at=12346 WHERE id='plot_001';
UPDATE vending_state SET coins=7,inspected_at='2026-11-09';
UPDATE world_food_trees SET seen_fruit='amber',stock=0,last_seen_stock=0 WHERE id='tree_001';
UPDATE world SET state='{"identity":"Changed","beliefs":[{"text":"garden"}],"tickCount":50}' WHERE id=1;
UPDATE world_control SET autonomous_enabled=0 WHERE id=1;
""")
db.executescript((ROOT/'reset/fresh-start.sql').read_text())
state=json.loads(db.execute('SELECT state FROM world WHERE id=1').fetchone()[0])
assert state['tickCount']==0 and state['beliefs']==[] and state['currentGoal'] is None
assert state['emotions']['curiosity']==0.35 and state['emotions']['hunger']==0.15
assert db.execute('SELECT x,y FROM world_position').fetchone()==(4,4)
assert db.execute('SELECT status,path,step_index FROM world_journey').fetchone()==('idle','[]',0)
assert db.execute('SELECT autonomous_enabled FROM world_control').fetchone()[0]==0
assert db.execute('SELECT hunger_rate FROM world_settings').fetchone()[0]==1/60
for table in ('documents','world_rewards','world_inspected','world_seen','world_food_inventory',
              'world_food_memory','garden_inventory','garden_transactions','vending_attempts',
              'object_notes','object_observations','object_observation_counts','action_trace',
              'experience_evaluations','decisions'):
    assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]==0,table
assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0]==1
assert db.execute('SELECT planted_at,watered_at FROM garden_plots WHERE id="plot_001"').fetchone()==(None,None)
assert db.execute('SELECT coins,inspected_at FROM vending_state').fetchone()==(0,None)
assert db.execute("SELECT stock,capacity,seen_fruit FROM world_food_trees WHERE id='tree_001'").fetchone()==(2,2,None)
assert db.execute('SELECT COUNT(*) FROM garden_plots').fetchone()[0]==3
assert db.execute('SELECT COUNT(*) FROM world_food_trees').fetchone()[0]==5
assert db.execute('SELECT COUNT(*) FROM world_visited').fetchone()[0]==1
print('Full Nimo reset SQL checked: learned history cleared, world mechanics retained.')
