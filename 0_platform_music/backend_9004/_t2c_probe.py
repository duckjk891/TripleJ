import asyncio, json
from dotenv import dotenv_values
from pymongo import MongoClient
env=dotenv_values(".env")
murl=env.get("MONGO_URL") or f"mongodb://{env['MONGO_USER']}:{env['MONGO_PASSWORD']}@{env['MONGO_HOST']}:{env['MONGO_PORT']}/{env['MONGO_DB']}?authSource=admin"
db=MongoClient(murl)[env["MONGO_DB"]]
print("total gens:", db.generations.count_documents({}))
print("completed:", db.generations.count_documents({"status":"completed"}))
print("completed w/ suno_task_id:", db.generations.count_documents({"status":"completed","suno_task_id":{"$ne":None}}))
# inspect recent completed
for doc in db.generations.find({"status":"completed"}, sort=[("created_at",-1)]).limit(8):
    vs=doc.get("variants") or []
    info=[]
    for v in vs:
        info.append({"aud":bool(v.get("suno_audio_id")),"ts":len(v.get("timestamps") or [])})
    print(str(doc["_id"])[:8], "task=",str(doc.get("suno_task_id"))[:8],"model=",doc.get("model"),"nvar=",len(vs),"vinfo=",info)
