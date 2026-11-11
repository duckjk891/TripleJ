import ast, pathlib, subprocess, os
base = pathlib.Path.home()/"cloudswitch/base"
os.chdir(base)
files = [f for f in subprocess.check_output(["git","diff","--name-only"],text=True).split() if f.startswith("app/routes/")]
for f in files:
    def routes(src):
        out = {}
        for n in ast.walk(ast.parse(src)):
            if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):
                for d in n.decorator_list:
                    if isinstance(d,ast.Call) and getattr(d.func,"attr","") in ("get","post","put","delete","patch") and d.args and isinstance(d.args[0],ast.Constant):
                        out[(d.func.attr,d.args[0].value)] = n.name
        return out
    old = routes(subprocess.check_output(["git","show","HEAD:"+f],text=True))
    new = routes(pathlib.Path(f).read_text(encoding="utf-8"))
    print(f, "SAME" if old==new else "DIFF %s" % (set(old.items())^set(new.items())), len(new))
