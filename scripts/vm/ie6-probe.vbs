' ZUKU Legacy: native IE6 fixture probe. ASCII source, WSH VBScript 5.x.
' Usage: cscript //nologo ie6-probe.vbs [C:\local\ie6-report.txt] [320..1280] [auto|text]
' Only the fixed fixture origin is navigated. No security settings are changed.
Option Explicit

Const FixtureOrigin = "http://10.0.2.100"
Const MaxPolls = 300
Dim Browser, FileSystem, ReportFile, Failures, Warnings, OutputPath
Dim NavigationBlocked, LastNavigationError
Dim RequestedWidth, ProbeMode, ExpectedPageScripts
Failures = 0
Warnings = 0
NavigationBlocked = False
LastNavigationError = ""
RequestedWidth = 1024
ProbeMode = "auto"
ExpectedPageScripts = 1
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

Function FixtureAbsoluteURL(value)
    Dim address, index, code
    FixtureAbsoluteURL = ""
    address = TextValue(value)
    If Len(address) = 0 Then Exit Function
    If Left(address, 2) = "//" Or InStr(address, "\") > 0 Then Exit Function
    For index = 1 To Len(address)
        code = AscW(Mid(address, index, 1))
        If code >= 0 And (code <= 32 Or code = 127) Then Exit Function
    Next
    If Left(address, 1) = "/" Then address = FixtureOrigin & address
    If LCase(address) = FixtureOrigin Then
        FixtureAbsoluteURL = FixtureOrigin & "/"
    ElseIf LCase(Left(address, Len(FixtureOrigin) + 1)) = FixtureOrigin & "/" Then
        FixtureAbsoluteURL = FixtureOrigin & Mid(address, Len(FixtureOrigin) + 1)
    End If
End Function

Function IsFixtureURL(value)
    Dim address
    address = TextValue(value)
    ' Navigation events must already contain an absolute fixture URL.
    IsFixtureURL = Left(LCase(address), Len(FixtureOrigin)) = FixtureOrigin And Len(FixtureAbsoluteURL(address)) > 0
End Function

Function IsFixtureNeonUXScript(value)
    Dim address, base, revision, index, character
    IsFixtureNeonUXScript = False
    address = FixtureAbsoluteURL(value)
    base = FixtureOrigin & "/legacy/assets/neonux-lc.js"
    If address = base Then
        IsFixtureNeonUXScript = True
        Exit Function
    End If
    If Left(address, Len(base) + 3) <> base & "?v=" Then Exit Function
    revision = Mid(address, Len(base) + 4)
    If Len(revision) < 8 Or Len(revision) > 64 Then Exit Function
    For index = 1 To Len(revision)
        character = Mid(revision, index, 1)
        If InStr("0123456789abcdef", character) = 0 Then Exit Function
    Next
    IsFixtureNeonUXScript = True
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

Function UnicodeText(codepoints)
    Dim codepoint, result
    result = ""
    For Each codepoint In Split(codepoints, " ")
        result = result & ChrW(CLng("&H" & codepoint))
    Next
    UnicodeText = result
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
    Dim destination, route
    route = relativeURL
    If ProbeMode = "text" And InStr(route, "mode=") = 0 Then
        If InStr(route, "?") > 0 Then
            route = route & "&mode=text"
        Else
            route = route & "?mode=text"
        End If
    End If
    destination = FixtureAbsoluteURL(route)
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
    Dim source, engine, enhancement, renderer, errorText, graphicCount, primitiveCount
    ' Query existing page globals; do not initialize or replace the app runtime.
    source = "(function(){var b=document.body,n=window.NeonUXLC,d=document.getElementsByTagName('div'),s=document.getElementsByTagName('span'),r='unobserved',g=0,p=0,i;" & _
        "b.setAttribute('data-lc-probe-engine',ScriptEngine()+' '+ScriptEngineMajorVersion()+'.'+ScriptEngineMinorVersion()+'.'+ScriptEngineBuildVersion());" & _
        "b.setAttribute('data-lc-probe-version',n&&n.version?n.version:'absent');" & _
        "for(i=0;i<d.length;i++){if(d[i]._neonuxLCSurface){r=d[i]._neonuxLCSurface.renderer;break;}}" & _
        "for(i=0;i<s.length;i++){if(s[i].className==='lc-graphic'){g++;p+=s[i].childNodes.length;}}" & _
        "b.setAttribute('data-lc-probe-renderer',r);b.setAttribute('data-lc-probe-graphics',g);b.setAttribute('data-lc-probe-primitives',p);})();"
    On Error Resume Next
    document.parentWindow.execScript source, "JScript"
    If Err.Number <> 0 Then
        errorText = CStr(Err.Number) & " " & Err.Description
        Err.Clear
        On Error GoTo 0
        WriteReport label & ".runtime", "unverified: page scripting is inaccessible through this COM boundary"
        Warn label & ".runtime unavailable: COM " & errorText & "; DOM checks remain valid; script execution is unverified"
        Exit Sub
    End If
    engine = TextValue(document.body.getAttribute("data-lc-probe-engine"))
    enhancement = TextValue(document.body.getAttribute("data-lc-probe-version"))
    renderer = TextValue(document.body.getAttribute("data-lc-probe-renderer"))
    graphicCount = TextValue(document.body.getAttribute("data-lc-probe-graphics"))
    primitiveCount = TextValue(document.body.getAttribute("data-lc-probe-primitives"))
    CheckCom label & ".runtime attributes"
    On Error GoTo 0
    WriteReport label & ".scriptEngine", engine
    WriteReport label & ".neonuxVersion", enhancement
    WriteReport label & ".renderer", renderer
    WriteReport label & ".graphicNodes", graphicCount
    WriteReport label & ".graphicChildNodes", primitiveCount
    AssertTrue Len(engine) > 0, label & ".script engine available"
    AssertTrue Len(enhancement) > 0 And enhancement <> "absent", label & ".NeonUX-LC loaded"
    If renderer = "unobserved" Or renderer = "" Then
        Warn label & ".no initialized surface observed; DOM fallback and failed enhancement initialization cannot be distinguished"
    ElseIf renderer = "vml" Then
        AssertTrue IsNumeric(graphicCount) And IsNumeric(primitiveCount), label & ".VML node counts available"
        If IsNumeric(graphicCount) And IsNumeric(primitiveCount) Then
            AssertTrue CLng(graphicCount) > 0 And CLng(primitiveCount) > 0, label & ".initialized VML surface and primitive nodes observed"
        End If
    End If
End Sub

Sub InspectUserAgent(label, document)
    Dim userAgent, errorNumber, errorText
    On Error Resume Next
    userAgent = document.parentWindow.navigator.userAgent
    errorNumber = Err.Number
    errorText = Err.Description
    Err.Clear
    On Error GoTo 0
    If errorNumber <> 0 Then
        WriteReport label & ".userAgent", "unobserved: navigator is inaccessible through this COM boundary"
        WriteReport label & ".identityEvidence", "Use recorded executable/MSHTML file versions; compare the fixture server's actual request UA separately"
        Warn label & ".navigator.userAgent unavailable: COM " & errorNumber & " " & errorText
    Else
        WriteReport label & ".userAgent", userAgent
        AssertTrue InStr(userAgent, "MSIE 6.") > 0, label & ".native IE6 user agent"
    End If
End Sub

Sub InspectNavigationGeometry(label, document)
    Dim lists, list, anchors, anchor, className, height, minimum, maximum
    Dim listCount, linkCount, tallestLabel
    minimum = 2147483647
    maximum = 0
    listCount = 0
    linkCount = 0
    tallestLabel = ""
    On Error Resume Next
    Set lists = document.getElementsByTagName("ul")
    CheckCom label & ".navigation list collection"
    For Each list In lists
        className = TextValue(list.className)
        CheckCom label & ".navigation list class"
        If InStr(" " & className & " ", " lc-nav ") > 0 Then
            listCount = listCount + 1
            Set anchors = list.getElementsByTagName("a")
            CheckCom label & ".navigation anchor collection"
            For Each anchor In anchors
                height = CDbl(anchor.offsetHeight)
                CheckCom label & ".navigation anchor height"
                linkCount = linkCount + 1
                If height < minimum Then minimum = height
                If height > maximum Then
                    maximum = height
                    tallestLabel = TextValue(anchor.innerText)
                    CheckCom label & ".navigation anchor label"
                End If
            Next
            CheckCom label & ".navigation anchor enumeration"
        End If
    Next
    CheckCom label & ".navigation list enumeration"
    On Error GoTo 0
    If linkCount = 0 Then minimum = 0
    WriteReport label & ".navigationListCount", listCount
    WriteReport label & ".navigationLinkCount", linkCount
    WriteReport label & ".navigationMinHeight", minimum
    WriteReport label & ".navigationMaxHeight", maximum
    WriteReport label & ".navigationTallestLabel", tallestLabel
    AssertTrue listCount > 0 And linkCount > 0, label & ".navigation links present for geometry checks"
    AssertTrue minimum > 0 And maximum <= minimum + 2, label & ".short navigation labels remain one line with consistent height"
End Sub

Sub InspectPage(label, expectedPath, expectedScripts)
    Dim document, headings, scripts, node, index, source, address, html
    Dim canonicalLinks, internalLinks, width, scrollWidth, bodyWidth, windowWidth
    Dim title, charset, heading, expectedHeading, scriptCount, headingCount, bodyMode, compatMode
    On Error Resume Next
    Set document = Browser.Document
    CheckCom label & ".Document"
    address = Browser.LocationURL
    CheckCom label & ".LocationURL"
    Set headings = document.getElementsByTagName("h1")
    CheckCom label & ".heading collection"
    Set scripts = document.getElementsByTagName("script")
    CheckCom label & ".script collection"
    html = LCase(document.documentElement.outerHTML)
    CheckCom label & ".documentElement.outerHTML"
    title = document.title
    CheckCom label & ".title"
    charset = document.charset
    CheckCom label & ".charset"
    compatMode = document.compatMode
    CheckCom label & ".compatMode"
    scriptCount = scripts.length
    CheckCom label & ".script count"
    headingCount = headings.length
    CheckCom label & ".heading count"
    bodyMode = TextValue(document.body.getAttribute("data-lc-mode"))
    CheckCom label & ".body mode"
    On Error GoTo 0
    WriteReport "PAGE", label
    WriteReport label & ".canonicalURL", address
    WriteReport label & ".title", title
    WriteReport label & ".charset", charset
    WriteReport label & ".compatMode", compatMode
    WriteReport label & ".scriptCount", scriptCount
    WriteReport label & ".mode", bodyMode
    AssertTrue IsFixtureURL(address) And URLPath(address) = expectedPath, label & ".canonical URL"
    AssertTrue InStr(address, "/legacy") = 0, label & ".no manual legacy route"
    AssertTrue InStr(title, "ZUKU Legacy") > 0, label & ".Legacy document title"
    AssertTrue LCase(charset) = "utf-8", label & ".UTF-8 document charset"
    AssertTrue compatMode = "CSS1Compat", label & ".HTML standards layout mode"
    AssertTrue headingCount = 1, label & ".one main heading"
    heading = ""
    On Error Resume Next
    If headingCount > 0 Then heading = headings.item(0).innerText
    CheckCom label & ".heading"
    On Error GoTo 0
    WriteReport label & ".heading", heading
    expectedHeading = ""
    Select Case label
        Case "home", "text"
            expectedHeading = UnicodeText("AC00 BCBC C6B4 0020 C6F9 002C 0020 B113 C740 0020 C138 ACC4 002E")
        Case "community"
            expectedHeading = UnicodeText("C9C0 AE08 002C 0020 B098 B204 ACE0 0020 C2F6 C740 0020 C774 C57C AE30")
        Case "content"
            expectedHeading = UnicodeText("C791 C740 0020 D654 BA74 C5D0 0020 B2F4 C740 0020 B113 C740 0020 C138 ACC4")
        Case "login"
            expectedHeading = UnicodeText("C548 C804 D55C 0020 C5F0 ACB0 BD80 D130 0020 C2DC C791 D574 C694")
        Case "direct-search", "native-search"
            expectedHeading = ChrW(&H201C) & ChrW(&HD55C) & ChrW(&HAE00) & UnicodeText("201D 0020 AC80 C0C9 0020 ACB0 ACFC")
    End Select
    AssertTrue Len(expectedHeading) > 0 And heading = expectedHeading, label & ".expected fixture heading, not an error page"
    On Error Resume Next
    Set node = document.getElementById("main")
    CheckCom label & ".main element"
    On Error GoTo 0
    AssertTrue Not node Is Nothing, label & ".main content present"
    AssertTrue scriptCount = expectedScripts, label & ".expected script count"
    If expectedScripts = 0 Then
        AssertTrue bodyMode = "text", label & ".text mode preserved"
    Else
        AssertTrue bodyMode = "auto", label & ".standard mode preserved"
    End If
    AssertTrue InStr(html, "/_next/") = 0 And InStr(html, "__next_data__") = 0, label & ".no Next bootstrap"
    For index = 0 To scriptCount - 1
        On Error Resume Next
        source = TextValue(scripts.item(index).src)
        CheckCom label & ".script source " & index
        On Error GoTo 0
        WriteReport label & ".script." & index, source
        AssertTrue IsFixtureNeonUXScript(source), label & ".fixture NeonUX script only"
        AssertTrue InStr(LCase(source), "react") = 0 And InStr(LCase(source), "webpack") = 0, label & ".no React or webpack scripts"
    Next
    canonicalLinks = 0
    internalLinks = 0
    On Error Resume Next
    For Each node In document.links
        source = TextValue(node.href)
        If IsFixtureURL(source) Then
            canonicalLinks = canonicalLinks + 1
            If Left(URLPath(source), 7) = "/legacy" Then internalLinks = internalLinks + 1
        End If
    Next
    CheckCom label & ".links"
    On Error GoTo 0
    WriteReport label & ".canonicalLinkCount", canonicalLinks
    AssertTrue canonicalLinks > 0 And internalLinks = 0, label & ".navigation links use canonical routes"
    InspectNavigationGeometry label, document
    On Error Resume Next
    windowWidth = Browser.Width
    CheckCom label & ".window width"
    width = document.documentElement.clientWidth
    CheckCom label & ".client width"
    scrollWidth = document.documentElement.scrollWidth
    CheckCom label & ".document scroll width"
    bodyWidth = document.body.scrollWidth
    CheckCom label & ".body scroll width"
    On Error GoTo 0
    WriteReport label & ".windowWidth", windowWidth
    WriteReport label & ".viewportWidth", width
    WriteReport label & ".documentScrollWidth", scrollWidth
    WriteReport label & ".bodyScrollWidth", bodyWidth
    AssertTrue width > 0 And scrollWidth <= width And bodyWidth <= width, label & ".document and body fit the viewport without horizontal overflow"
    InspectUserAgent label, document
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
    Dim document, input, form, address, heading, resultWords, formAction, formMethod
    NavigateFixture "search-form-home", "/"
    On Error Resume Next
    Set document = Browser.Document
    Set input = document.getElementById("q")
    CheckCom "search-form.input"
    If input Is Nothing Then Fatal "Native search input #q is missing"
    Set form = input.form
    CheckCom "search-form.form"
    If form Is Nothing Then Fatal "Native search input has no form"
    formMethod = TextValue(form.method)
    CheckCom "search-form.method"
    formAction = TextValue(form.action)
    CheckCom "search-form.action"
    If LCase(formMethod) <> "get" Then Fatal "Search form is not GET"
    If FixtureAbsoluteURL(formAction) <> FixtureOrigin & "/search" Then Fatal "Search form action is not the fixed canonical fixture URL"
    input.value = query
    CheckCom "search-form.value"
    NavigationBlocked = False
    LastNavigationError = ""
    ' Invoke the HTML form's native GET serializer, not a constructed navigation.
    form.submit
    CheckCom "search-form.submit"
    On Error GoTo 0
    WaitReady "native-search", "/search"
    InspectPage "native-search", "/search", ExpectedPageScripts
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
    AssertTrue QueryValue(address, "mode") = ProbeMode, "native search preserves the requested display mode"
    AssertTrue InStr(heading, query) > 0 And InStr(heading, resultWords) > 0, "native search heading contains the Korean query and results label"
End Sub

Sub Main()
    Dim drive, shell, systemRoot, executableVersion, mshtmlVersion, kernelVersion, query, widthArgument, index, code
    If LCase(Right(WScript.FullName, 11)) <> "cscript.exe" Then
        WScript.Echo "Run this probe from a command prompt: cscript //nologo ie6-probe.vbs"
        WScript.Quit 2
    End If
    If WScript.Arguments.Count > 3 Then
        WScript.Echo "Usage: cscript //nologo ie6-probe.vbs [C:\local\ie6-report.txt] [320..1280] [auto|text]"
        WScript.Quit 2
    End If
    If WScript.Arguments.Count >= 2 Then
        widthArgument = CStr(WScript.Arguments(1))
        If Len(widthArgument) < 3 Or Len(widthArgument) > 4 Then Fatal "Window width must be 320..1280"
        For index = 1 To Len(widthArgument)
            code = Asc(Mid(widthArgument, index, 1))
            If code < 48 Or code > 57 Then Fatal "Window width must contain decimal digits only"
        Next
        RequestedWidth = CLng(widthArgument)
        If RequestedWidth < 320 Or RequestedWidth > 1280 Then Fatal "Window width must be 320..1280"
    End If
    If WScript.Arguments.Count >= 3 Then
        ProbeMode = LCase(CStr(WScript.Arguments(2)))
        If ProbeMode <> "auto" And ProbeMode <> "text" Then Fatal "Display mode must be auto or text"
        If ProbeMode = "text" Then ExpectedPageScripts = 0
    End If
    On Error Resume Next
    Set FileSystem = CreateObject("Scripting.FileSystemObject")
    CheckCom "Create FileSystemObject"
    If WScript.Arguments.Count >= 1 Then
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
    WriteReport "requestedWindowWidth", RequestedWidth
    WriteReport "matrixMode", ProbeMode
    WriteReport "wshVersion", WScript.Version
    WriteReport "wshScriptEngine", ScriptEngine & " " & ScriptEngineMajorVersion & "." & ScriptEngineMinorVersion & "." & ScriptEngineBuildVersion
    Set Browser = WScript.CreateObject("InternetExplorer.Application", "IE_")
    CheckCom "Create InternetExplorer.Application with navigation event guard"
    Browser.Visible = True
    Browser.Width = RequestedWidth
    Browser.Height = 768
    Browser.Left = 0
    Browser.Top = 0
    CheckCom "Show native IE window"
    executableVersion = FileSystem.GetFileVersion(Browser.FullName)
    Set shell = CreateObject("WScript.Shell")
    systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
    mshtmlVersion = FileSystem.GetFileVersion(FileSystem.BuildPath(systemRoot, "system32\mshtml.dll"))
    kernelVersion = FileSystem.GetFileVersion(FileSystem.BuildPath(systemRoot, "system32\kernel32.dll"))
    CheckCom "Read native browser file versions"
    On Error GoTo 0
    WriteReport "browser.executableVersion", executableVersion
    WriteReport "browser.mshtmlVersion", mshtmlVersion
    WriteReport "platform.kernel32Version", kernelVersion
    AssertTrue Left(executableVersion, 2) = "6." And Left(mshtmlVersion, 2) = "6.", "native IE6 executable and MSHTML engine versions"
    On Error GoTo 0

    query = ChrW(&HD55C) & ChrW(&HAE00)
    NavigateFixture "home", "/"
    InspectPage "home", "/", ExpectedPageScripts
    NavigateFixture "community", "/community"
    InspectPage "community", "/community", ExpectedPageScripts
    NavigateFixture "direct-search", "/search?q=" & EncodeUTF8(query)
    InspectPage "direct-search", "/search", ExpectedPageScripts
    NavigateFixture "content", "/content/cnt_demo"
    InspectPage "content", "/content/cnt_demo", ExpectedPageScripts
    NavigateFixture "login", "/login"
    InspectPage "login", "/login", ExpectedPageScripts
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
