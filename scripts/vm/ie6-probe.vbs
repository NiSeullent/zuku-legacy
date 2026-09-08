' ZUKU Legacy: native IE6 fixture probe. ASCII source, WSH VBScript 5.x.
' Usage: cscript //nologo ie6-probe.vbs [C:\local\ie6-report.txt]
' Only the fixed fixture origin is navigated. No security settings are changed.
Option Explicit

Const FixtureOrigin = "http://10.0.2.100"
Const MaxPolls = 300
Dim Browser, FileSystem, ReportFile, Failures, Warnings, OutputPath
Dim NavigationBlocked, LastNavigationError
Failures = 0
Warnings = 0
NavigationBlocked = False
LastNavigationError = ""
Set Browser = Nothing
Set ReportFile = Nothing

Sub WriteReport(key, value)
    Dim line
    line = key & "=" & Replace(Replace(CStr(value), vbCr, "\r"), vbLf, "\n")
    On Error Resume Next
    If Not ReportFile Is Nothing Then ReportFile.WriteLine line
    If Err.Number <> 0 Then
        WScript.Echo "FATAL=Cannot write local report: " & Err.Description
        WScript.Quit 1
    End If
    WScript.Echo line
    On Error GoTo 0
End Sub

Sub Fatal(message)
    On Error Resume Next
    WriteReport "FATAL", message
    WriteReport "RESULT", "FAIL"
    If Not ReportFile Is Nothing Then ReportFile.Close
    WScript.Quit 1
End Sub

Sub CheckCom(context)
    Dim number, description
    number = Err.Number
    description = Err.Description
    Err.Clear
    If number <> 0 Then Fatal context & ": COM " & number & " " & description
End Sub

Sub AssertTrue(condition, label)
    If condition Then
        WriteReport "PASS", label
    Else
        Failures = Failures + 1
        WriteReport "FAIL", label
    End If
End Sub

Sub Warn(message)
    Warnings = Warnings + 1
    WriteReport "WARN", message
End Sub

Function TextValue(value)
    If IsNull(value) Or IsEmpty(value) Then
        TextValue = ""
    Else
        TextValue = CStr(value)
    End If
End Function

Function IsFixtureURL(value)
    Dim address
    address = LCase(CStr(value))
    IsFixtureURL = (address = FixtureOrigin Or Left(address, Len(FixtureOrigin) + 1) = FixtureOrigin & "/")
End Function

Function URLPath(value)
    Dim address, position
    address = CStr(value)
    If Not IsFixtureURL(address) Then
        URLPath = "!outside-fixture"
        Exit Function
    End If
    address = Mid(address, Len(FixtureOrigin) + 1)
    position = InStr(address, "?")
    If position > 0 Then address = Left(address, position - 1)
    position = InStr(address, "#")
    If position > 0 Then address = Left(address, position - 1)
    If address = "" Then address = "/"
    URLPath = address
End Function

Function QueryValue(address, name)
    Dim position, pair, parts
    QueryValue = ""
    position = InStr(address, "?")
    If position = 0 Then Exit Function
    For Each pair In Split(Mid(address, position + 1), "&")
        parts = Split(pair, "=", 2)
        If UBound(parts) = 1 Then
            If LCase(parts(0)) = LCase(name) Then
                QueryValue = parts(1)
                Exit Function
            End If
        End If
    Next
End Function

Function PercentByte(value)
    PercentByte = "%" & Right("0" & Hex(value), 2)
End Function

Function EncodeUTF8(value)
    Dim index, code, result
    result = ""
    For index = 1 To Len(value)
        code = AscW(Mid(value, index, 1))
        If code < 0 Then code = code + 65536
        If code < 128 Then
            result = result & PercentByte(code)
        ElseIf code < 2048 Then
            result = result & PercentByte(192 Or (code \ 64)) & PercentByte(128 Or (code Mod 64))
        Else
            result = result & PercentByte(224 Or (code \ 4096)) & PercentByte(128 Or ((code \ 64) Mod 64)) & PercentByte(128 Or (code Mod 64))
        End If
    Next
    EncodeUTF8 = result
End Function

' Connected by WScript.CreateObject. Cancel unexpected redirects and popups.
Sub IE_BeforeNavigate2(pDisp, address, flags, targetFrame, postData, headers, cancel)
    If Not IsFixtureURL(address) Then
        cancel = True
        NavigationBlocked = True
        LastNavigationError = "Canceled navigation outside the fixed fixture origin"
    End If
End Sub

Sub IE_NewWindow2(pDisp, cancel)
    cancel = True
    NavigationBlocked = True
    LastNavigationError = "Canceled an unexpected popup"
End Sub

Sub IE_NavigateError(pDisp, address, targetFrame, statusCode, cancel)
    LastNavigationError = "Navigation error " & CStr(statusCode)
End Sub

Sub WaitReady(label, expectedPath)
    Dim attempt, busy, state, address, document, lastError
    lastError = ""
    On Error Resume Next
    For attempt = 1 To MaxPolls
        WScript.Sleep 100
        If NavigationBlocked Then Fatal label & ": " & LastNavigationError
        Err.Clear
        busy = Browser.Busy
        state = Browser.ReadyState
        address = Browser.LocationURL
        If Err.Number <> 0 Then
            lastError = CStr(Err.Number) & " " & Err.Description
            Err.Clear
        ElseIf Not busy And state = 4 Then
            If IsFixtureURL(address) And URLPath(address) = expectedPath Then
                Set document = Browser.Document
                If Err.Number = 0 Then
                    state = document.readyState
                    If Err.Number = 0 And LCase(CStr(state)) = "complete" Then
                        On Error GoTo 0
                        Exit Sub
                    End If
                End If
                lastError = CStr(Err.Number) & " " & Err.Description
                Err.Clear
            End If
        End If
    Next
    On Error GoTo 0
    Fatal label & ": timed out after 30 seconds; " & LastNavigationError & "; COM=" & lastError
End Sub

Sub NavigateFixture(label, relativeURL)
    Dim destination
    destination = FixtureOrigin & relativeURL
    If Not IsFixtureURL(destination) Then Fatal "Invalid fixture destination"
    NavigationBlocked = False
    LastNavigationError = ""
    On Error Resume Next
    Browser.Navigate destination
    CheckCom label & ".Navigate"
    On Error GoTo 0
    WaitReady label, URLPath(destination)
End Sub

Sub InspectRuntime(label, document)
    Dim source, engine, enhancement, renderer, errorText
    ' Query existing page globals; do not initialize or replace the app runtime.
    source = "(function(){var b=document.body,n=window.NeonUXLC,d=document.getElementsByTagName('div'),r='dom',i;" & _
        "b.setAttribute('data-lc-probe-engine',ScriptEngine()+' '+ScriptEngineMajorVersion()+'.'+ScriptEngineMinorVersion()+'.'+ScriptEngineBuildVersion());" & _
        "b.setAttribute('data-lc-probe-version',n&&n.version?n.version:'absent');" & _
        "for(i=0;i<d.length;i++){if(d[i]._neonuxLCSurface){r=d[i]._neonuxLCSurface.renderer;break;}}" & _
        "b.setAttribute('data-lc-probe-renderer',r);})();"
    On Error Resume Next
    document.parentWindow.execScript source, "JScript"
    If Err.Number <> 0 Then
        errorText = CStr(Err.Number) & " " & Err.Description
        Err.Clear
        On Error GoTo 0
        Warn label & ".runtime unavailable: COM " & errorText & "; DOM checks remain valid; script execution is unverified"
        Exit Sub
    End If
    engine = TextValue(document.body.getAttribute("data-lc-probe-engine"))
    enhancement = TextValue(document.body.getAttribute("data-lc-probe-version"))
    renderer = TextValue(document.body.getAttribute("data-lc-probe-renderer"))
    CheckCom label & ".runtime attributes"
    On Error GoTo 0
    WriteReport label & ".scriptEngine", engine
    WriteReport label & ".neonuxVersion", enhancement
    WriteReport label & ".renderer", renderer
    AssertTrue Len(engine) > 0, label & ".script engine available"
    AssertTrue Len(enhancement) > 0 And enhancement <> "absent", label & ".NeonUX-LC loaded"
End Sub

Sub InspectPage(label, expectedPath, expectedScripts)
    Dim document, headings, scripts, node, index, source, address, html
    Dim canonicalLinks, internalLinks, userAgent, width, scrollWidth, bodyWidth
    On Error Resume Next
    Set document = Browser.Document
    CheckCom label & ".Document"
    address = Browser.LocationURL
    userAgent = document.parentWindow.navigator.userAgent
    Set headings = document.getElementsByTagName("h1")
    Set scripts = document.getElementsByTagName("script")
    html = LCase(document.documentElement.outerHTML)
    CheckCom label & ".DOM properties"
    WriteReport "PAGE", label
    WriteReport label & ".canonicalURL", address
    WriteReport label & ".userAgent", userAgent
    WriteReport label & ".title", document.title
    WriteReport label & ".charset", document.charset
    WriteReport label & ".scriptCount", scripts.length
    CheckCom label & ".metadata"
    AssertTrue IsFixtureURL(address) And URLPath(address) = expectedPath, label & ".canonical URL"
    AssertTrue InStr(address, "/legacy") = 0, label & ".no manual legacy route"
    AssertTrue InStr(userAgent, "MSIE 6.") > 0, label & ".native IE6 user agent"
    AssertTrue InStr(document.title, "ZUKU Legacy") > 0, label & ".Legacy document title"
    AssertTrue headings.length = 1, label & ".one main heading"
    If headings.length > 0 Then WriteReport label & ".heading", headings.item(0).innerText
    Set node = document.getElementById("main")
    AssertTrue Not node Is Nothing, label & ".main content present"
    AssertTrue scripts.length = expectedScripts, label & ".expected script count"
    AssertTrue InStr(html, "/_next/") = 0 And InStr(html, "__next_data__") = 0, label & ".no Next bootstrap"
    For index = 0 To scripts.length - 1
        source = TextValue(scripts.item(index).src)
        WriteReport label & ".script." & index, source
        AssertTrue source = FixtureOrigin & "/legacy/assets/neonux-lc.js", label & ".fixture NeonUX script only"
        AssertTrue InStr(LCase(source), "react") = 0 And InStr(LCase(source), "webpack") = 0, label & ".no React or webpack scripts"
    Next
    canonicalLinks = 0
    internalLinks = 0
    For Each node In document.links
        source = TextValue(node.href)
        If IsFixtureURL(source) Then
            canonicalLinks = canonicalLinks + 1
            If Left(URLPath(source), 7) = "/legacy" Then internalLinks = internalLinks + 1
        End If
    Next
    CheckCom label & ".links and scripts"
    WriteReport label & ".canonicalLinkCount", canonicalLinks
    AssertTrue canonicalLinks > 0 And internalLinks = 0, label & ".navigation links use canonical routes"
    width = document.documentElement.clientWidth
    scrollWidth = document.documentElement.scrollWidth
    bodyWidth = document.body.scrollWidth
    CheckCom label & ".layout measurements"
    WriteReport label & ".viewportWidth", width
    WriteReport label & ".documentScrollWidth", scrollWidth
    WriteReport label & ".bodyScrollWidth", bodyWidth
    If width > 0 And scrollWidth > width + 2 Then Warn label & ".horizontal document overflow"
    On Error GoTo 0
    If expectedScripts > 0 Then
        InspectRuntime label, document
    Else
        WriteReport label & ".runtime", "Not injected: text response contains no scripts"
    End If
End Sub

Sub CheckPublicLogin()
    Dim document, input, form, passwordCount, postCount
    passwordCount = 0
    postCount = 0
    On Error Resume Next
    Set document = Browser.Document
    For Each input In document.getElementsByTagName("input")
        If LCase(TextValue(input.type)) = "password" Then passwordCount = passwordCount + 1
    Next
    For Each form In document.forms
        If LCase(TextValue(form.method)) = "post" Then postCount = postCount + 1
    Next
    CheckCom "login.fields"
    On Error GoTo 0
    WriteReport "login.passwordInputs", passwordCount
    WriteReport "login.postForms", postCount
    AssertTrue passwordCount = 0 And postCount = 0, "unprotected HTTP has no account mutation form"
End Sub

Sub SubmitKoreanSearch(query)
    Dim document, input, form, address, heading, resultWords
    NavigateFixture "search-form-home", "/"
    On Error Resume Next
    Set document = Browser.Document
    Set input = document.getElementById("q")
    CheckCom "search-form.input"
    If input Is Nothing Then Fatal "Native search input #q is missing"
    Set form = input.form
    CheckCom "search-form.form"
    If form Is Nothing Then Fatal "Native search input has no form"
    If LCase(TextValue(form.method)) <> "get" Then Fatal "Search form is not GET"
    If TextValue(form.action) <> FixtureOrigin & "/search" Then Fatal "Search form action is not the fixed canonical fixture URL"
    input.value = query
    CheckCom "search-form.value"
    NavigationBlocked = False
    LastNavigationError = ""
    ' Invoke the HTML form's native GET serializer, not a constructed navigation.
    form.submit
    CheckCom "search-form.submit"
    On Error GoTo 0
    WaitReady "native-search", "/search"
    InspectPage "native-search", "/search", 1
    On Error Resume Next
    address = Browser.LocationURL
    Set document = Browser.Document
    heading = document.getElementsByTagName("h1").item(0).innerText
    CheckCom "native-search.result"
    On Error GoTo 0
    resultWords = ChrW(&HAC80) & ChrW(&HC0C9) & " " & ChrW(&HACB0) & ChrW(&HACFC)
    WriteReport "native-search.expectedQueryUTF8", EncodeUTF8(query)
    WriteReport "native-search.actualQuery", QueryValue(address, "q")
    AssertTrue UCase(QueryValue(address, "q")) = EncodeUTF8(query), "native search preserves Korean UTF-8 URL encoding"
    AssertTrue InStr(heading, query) > 0 And InStr(heading, resultWords) > 0, "native search heading contains the Korean query and results label"
End Sub

Sub Main()
    Dim drive, shell, systemRoot, executableVersion, mshtmlVersion, query
    If LCase(Right(WScript.FullName, 11)) <> "cscript.exe" Then
        WScript.Echo "Run this probe from a command prompt: cscript //nologo ie6-probe.vbs"
        WScript.Quit 2
    End If
    If WScript.Arguments.Count > 1 Then
        WScript.Echo "Usage: cscript //nologo ie6-probe.vbs [C:\local\ie6-report.txt]"
        WScript.Quit 2
    End If
    On Error Resume Next
    Set FileSystem = CreateObject("Scripting.FileSystemObject")
    CheckCom "Create FileSystemObject"
    If WScript.Arguments.Count = 1 Then
        OutputPath = WScript.Arguments(0)
    Else
        OutputPath = FileSystem.BuildPath(FileSystem.GetParentFolderName(WScript.ScriptFullName), "ie6-report.txt")
    End If
    If Len(OutputPath) < 4 Then Fatal "Report path must be an absolute local drive path"
    If Mid(OutputPath, 2, 2) <> ":\" Then Fatal "Report path must be an absolute local drive path; UNC paths are rejected"
    Set drive = FileSystem.GetDrive(FileSystem.GetDriveName(OutputPath))
    CheckCom "Report drive"
    If drive.DriveType = 3 Then Fatal "Report output cannot use a network drive"
    Set ReportFile = FileSystem.CreateTextFile(OutputPath, True, True)
    CheckCom "Create local UTF-16 report"
    WriteReport "probe", "ZUKU Legacy native IE6 fixture checks"
    WriteReport "fixtureOrigin", FixtureOrigin
    WriteReport "startedLocalTime", Now
    WriteReport "reportEncoding", "UTF-16LE with BOM"
    WriteReport "reportPath", OutputPath
    WriteReport "wshVersion", WScript.Version
    WriteReport "wshScriptEngine", ScriptEngine & " " & ScriptEngineMajorVersion & "." & ScriptEngineMinorVersion & "." & ScriptEngineBuildVersion
    Set Browser = WScript.CreateObject("InternetExplorer.Application", "IE_")
    CheckCom "Create InternetExplorer.Application with navigation event guard"
    Browser.Visible = True
    Browser.Width = 1024
    Browser.Height = 768
    CheckCom "Show native IE window"
    executableVersion = FileSystem.GetFileVersion(Browser.FullName)
    Set shell = CreateObject("WScript.Shell")
    systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
    mshtmlVersion = FileSystem.GetFileVersion(FileSystem.BuildPath(systemRoot, "system32\mshtml.dll"))
    CheckCom "Read native browser file versions"
    WriteReport "browser.executableVersion", executableVersion
    WriteReport "browser.mshtmlVersion", mshtmlVersion
    WriteReport "platform.kernel32Version", FileSystem.GetFileVersion(FileSystem.BuildPath(systemRoot, "system32\kernel32.dll"))
    CheckCom "Read OS kernel file version"
    AssertTrue Left(executableVersion, 2) = "6." And Left(mshtmlVersion, 2) = "6.", "native IE6 executable and MSHTML engine versions"
    On Error GoTo 0

    query = ChrW(&HD55C) & ChrW(&HAE00)
    NavigateFixture "home", "/"
    InspectPage "home", "/", 1
    NavigateFixture "community", "/community"
    InspectPage "community", "/community", 1
    NavigateFixture "direct-search", "/search?q=" & EncodeUTF8(query)
    InspectPage "direct-search", "/search", 1
    NavigateFixture "content", "/content/cnt_demo"
    InspectPage "content", "/content/cnt_demo", 1
    NavigateFixture "login", "/login"
    InspectPage "login", "/login", 1
    CheckPublicLogin
    NavigateFixture "text", "/?mode=text"
    InspectPage "text", "/", 0
    SubmitKoreanSearch query
    NavigateFixture "final-home", "/"
    WriteReport "finishedLocalTime", Now
    WriteReport "failures", Failures
    WriteReport "warnings", Warnings
    If Failures > 0 Then
        WriteReport "RESULT", "FAIL"
    ElseIf Warnings > 0 Then
        WriteReport "RESULT", "PASS_WITH_LIMITATIONS"
    Else
        WriteReport "RESULT", "PASS"
    End If
    WriteReport "browserState", "Left visible on the fixture home page for a screenshot"
    ReportFile.Close
    If Failures > 0 Then WScript.Quit 1
    WScript.Quit 0
End Sub

Main
