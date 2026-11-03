import bpy, os, sys
HERE=os.path.dirname(os.path.abspath(bpy.data.filepath))
ed=bpy.data.scenes["Edit"]; bpy.context.window.scene=ed if bpy.context.window else None
ed.render.resolution_percentage=25
ed.render.image_settings.file_format="PNG"
se=ed.sequence_editor; S=se.strips if hasattr(se,'strips') else se.sequences
cuts=sorted([s for s in S if s.type=='SCENE'], key=lambda s:s.frame_final_start)
for s in cuts:
    f=(s.frame_final_start+s.frame_final_end)//2
    ed.frame_current=f; ed.frame_set(f)
    ed.render.filepath=os.path.join(HERE,"stills",f"{s.name}.png")
    bpy.ops.render.render(write_still=True, scene=ed.name)
print("STILLS_DONE",len(cuts))
