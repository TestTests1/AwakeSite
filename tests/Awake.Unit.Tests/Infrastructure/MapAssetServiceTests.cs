using Awake.Application.Common.Interfaces;
using Awake.Infrastructure.ExternalServices.Maps;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Moq;

namespace Awake.Unit.Tests.Infrastructure;

public class MapAssetServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "awake-maps-" + Guid.NewGuid().ToString("N"));

    public MapAssetServiceTests()
    {
        Directory.CreateDirectory(Path.Combine(_root, "MapAssets"));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
        GC.SuppressFinalize(this);
    }

    private MapAssetService BuildService(string? baseUrl = null, string? chunkBaseUrl = null)
    {
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(e => e.ContentRootPath).Returns(_root);

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["MapAssets:BaseUrl"] = baseUrl,
                ["MapAssets:ChunkBaseUrl"] = chunkBaseUrl,
            })
            .Build();

        return new MapAssetService(env.Object, configuration);
    }

    private string CreateModel(string fileName)
    {
        var path = Path.Combine(_root, "MapAssets", fileName);
        File.WriteAllBytes(path, "glTF"u8.ToArray());
        return path;
    }

    private string CreateChunkFile(string canonicalLocation, string fileName)
    {
        var dir = Path.Combine(_root, "MapAssets", "v2", canonicalLocation);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, fileName);
        File.WriteAllBytes(path, "glTF"u8.ToArray());
        return path;
    }

    [Theory]
    [InlineData("hvoiny")]
    [InlineData("small_berdovka")]
    [InlineData("nizina")]
    public void GetModelSource_KnownLocationWithFile_ReturnsPath(string location)
    {
        var expected = CreateModel($"{location}.glb");

        BuildService().GetModelSource(location)
            .Should().BeOfType<MapModelSource.LocalFile>()
            .Which.Path.Should().Be(expected);
    }

    [Fact]
    public void GetModelSource_KnownLocationWithoutFile_ReturnsNull()
    {
        BuildService().GetModelSource("hvoiny").Should().BeNull();
    }

    [Fact]
    public void GetModelSource_UnknownLocation_ReturnsNull()
    {
        CreateModel("pripyat.glb");

        BuildService().GetModelSource("pripyat").Should().BeNull();
    }

    [Theory]
    [InlineData("../appsettings")]
    [InlineData("..\\appsettings")]
    [InlineData("../../secrets")]
    [InlineData("hvoiny/../../appsettings")]
    [InlineData("C:\\Windows\\win")]
    [InlineData("")]
    public void GetModelSource_PathTraversalAttempt_ReturnsNull(string location)
    {
        BuildService().GetModelSource(location).Should().BeNull();
    }

    [Fact]
    public void GetModelSource_IsCaseInsensitive()
    {
        var expected = CreateModel("hvoiny.glb");

        BuildService().GetModelSource("HVOINY")
            .Should().BeOfType<MapModelSource.LocalFile>()
            .Which.Path.Should().Be(expected);
    }

    [Fact]
    public void GetModelSource_WithBaseUrl_ReturnsRemoteUrl()
    {
        BuildService("https://models.example.com/maps/v1").GetModelSource("nizina")
            .Should().BeOfType<MapModelSource.RemoteUrl>()
            .Which.Url.Should().Be("https://models.example.com/maps/v1/nizina.glb");
    }

    [Fact]
    public void GetModelSource_WithBaseUrl_DoesNotNeedLocalFile()
    {
        // на боевом моделей рядом с приложением нет вовсе — в этом весь смысл
        BuildService("https://models.example.com").GetModelSource("hvoiny")
            .Should().BeOfType<MapModelSource.RemoteUrl>();
    }

    [Fact]
    public void GetModelSource_WithBaseUrl_UsesCanonicalName()
    {
        // имя для адреса берётся из белого списка, а не из запроса
        BuildService("https://models.example.com").GetModelSource("NIZINA")
            .Should().BeOfType<MapModelSource.RemoteUrl>()
            .Which.Url.Should().EndWith("/nizina.glb");
    }

    [Theory]
    [InlineData("https://models.example.com/")]
    [InlineData("https://models.example.com")]
    public void GetModelSource_BaseUrlSlashIsNormalised(string baseUrl)
    {
        BuildService(baseUrl).GetModelSource("nizina")
            .Should().BeOfType<MapModelSource.RemoteUrl>()
            .Which.Url.Should().Be("https://models.example.com/nizina.glb");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void GetModelSource_BlankBaseUrl_FallsBackToDisk(string baseUrl)
    {
        var expected = CreateModel("nizina.glb");

        BuildService(baseUrl).GetModelSource("nizina")
            .Should().BeOfType<MapModelSource.LocalFile>()
            .Which.Path.Should().Be(expected);
    }

    [Fact]
    public void GetModelSource_WithBaseUrl_StillRejectsUnknownLocation()
    {
        BuildService("https://models.example.com").GetModelSource("../secrets").Should().BeNull();
    }

    [Theory]
    // те же попытки выйти за пределы каталога, что и для GetModelSource
    [InlineData("../appsettings")]
    [InlineData("..\\appsettings")]
    [InlineData("../../secrets")]
    [InlineData("hvoiny/../../appsettings")]
    [InlineData("C:\\Windows\\win")]
    [InlineData("")]
    // и то, что бьёт именно по образцу имени куска
    [InlineData("../manifest.json")]
    [InlineData("c_1_1.glb/../../appsettings.json")]
    [InlineData("manifest.json.bak")]
    [InlineData("materials.glb%00.txt")]
    [InlineData("sub/manifest.json")]
    public void GetChunkFilePath_HostileFileName_ReturnsNull(string file)
    {
        BuildService().GetChunkFilePath("nizina", file).Should().BeNull();
    }

    [Theory]
    [InlineData("manifest.json")]
    [InlineData("materials.glb")]
    [InlineData("c_0_0.glb")]
    [InlineData("c_-3_-12.glb")]
    public void GetChunkFilePath_LegitimateFileNameWithFileOnDisk_ReturnsPath(string file)
    {
        // Файл кладём реально на диск: только не-null путь на выходе доказывает,
        // что образец принял имя, а не отбраковал его ещё до проверки File.Exists.
        var expected = CreateChunkFile("nizina", file);

        BuildService().GetChunkFilePath("nizina", file).Should().Be(expected);
    }

    [Fact]
    public void GetChunkFilePath_UnknownLocation_ReturnsNull()
    {
        BuildService().GetChunkFilePath("pripyat", "manifest.json").Should().BeNull();
    }

    [Theory]
    [InlineData("https://models.example.com/maps/v2")]
    [InlineData("https://models.example.com/maps/v2/")]
    public void GetChunkBaseUrl_WithConfiguredBaseUrl_ReturnsRemotePrefixWithSingleTrailingSlash(string configured)
    {
        BuildService(chunkBaseUrl: configured).GetChunkBaseUrl("nizina")
            .Should().Be("https://models.example.com/maps/v2/nizina/");
    }

    [Fact]
    public void GetChunkBaseUrl_WithoutConfiguredBaseUrl_ReturnsStandFallback()
    {
        BuildService().GetChunkBaseUrl("nizina").Should().Be("/api/maps/nizina/chunks/");
    }

    [Fact]
    public void GetChunkBaseUrl_UnknownLocation_ReturnsNull()
    {
        BuildService().GetChunkBaseUrl("pripyat").Should().BeNull();
    }
}
