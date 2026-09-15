#!/usr/bin/env python3
"""Verify an installed or bundled executable without a display or the user's vault."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary=str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix='pablock-package-test-') as directory:
    root=Path(directory)
    project=root/'project'
    project.mkdir()
    (project/'.env').write_text('TOKEN=package-fixture\nKEEP=retained\n')
    env=dict(os.environ,XDG_DATA_HOME=str(root/'data'),APPIMAGE_EXTRACT_AND_RUN='1')
    env.pop('DISPLAY',None)
    env.pop('WAYLAND_DISPLAY',None)
    password='package-test-password'
    def run(args,value=None,expected=0):
        result=subprocess.run([binary,'--json','--password-stdin',*args],input=password+'\n'+(value or ''),text=True,capture_output=True,cwd=project,env=env,timeout=30)
        assert result.returncode==expected,(args,result.returncode,result.stderr)
        if expected:
            return json.loads(result.stderr)
        return json.loads(result.stdout)
    assert not run(['vault','status'])['initialized']
    run(['vault','init'])
    p=run(['project','add'])
    run(['import','.env','--yes'])
    assert run(['secret','get','TOKEN'])['redacted']
    assert run(['secret','get','TOKEN','--reveal'])['value']=='package-fixture'
    run(['secret','set','TOKEN','--value-stdin'],'line 1\nline 2\n')
    assert run(['secret','get','TOKEN','--reveal'])['value']=='line 1\nline 2\n'
    versions=run(['secret','history','TOKEN'])
    assert len(versions)==2
    run(['secret','restore','TOKEN',versions[-1]['id']])
    assert run(['secret','get','TOKEN','--reveal'])['value']=='package-fixture'
    # Preview output precedes a JSON conflict on stderr for unconfirmed export.
    conflict=subprocess.run([binary,'--password-stdin','export'],input=password+'\n',text=True,capture_output=True,cwd=project,env=env)
    assert conflict.returncode==5
    run(['export','--to','output.env'])
    assert (project/'output.env').read_text()=='KEEP="retained"\nTOKEN="package-fixture"\n'
    run(['secret','clear-history','TOKEN','--yes'])
    assert len(run(['secret','history','TOKEN']))==1
    run(['project','remove','--yes'])
    assert run(['project','list'])==[]
    assert (project/'.env').exists()
    assert p['root']==str(project.resolve())
    print('PASS: packaged headless CLI, stdin, redaction, reveal, history/restore, export, and project removal')
