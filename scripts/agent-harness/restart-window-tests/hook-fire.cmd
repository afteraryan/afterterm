@echo off
rem Test hook: appends the event name it was given to a log beside this file.
>>"%~dp0hook-fired.log" echo %1
exit /b 0
