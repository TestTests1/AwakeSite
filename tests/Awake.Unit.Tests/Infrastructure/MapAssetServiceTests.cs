using Awake.Infrastructure.ExternalServices.Maps;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
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

    private MapAssetService BuildService()
    {
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(e => e.ContentRootPath).Returns(_root);
        return new MapAssetService(env.Object);
    }

    private string CreateModel(string fileName)
    {
        var path = Path.Combine(_root, "MapAssets", fileName);
        File.WriteAllBytes(path, "glTF"u8.ToArray());
        return path;
    }

    [Theory]
    [InlineData("hvoiny")]
    [InlineData("small_berdovka")]
    [InlineData("nizina")]
    public void GetModelPath_KnownLocationWithFile_ReturnsPath(string location)
    {
        var expected = CreateModel($"{location}.glb");

        BuildService().GetModelPath(location).Should().Be(expected);
    }

    [Fact]
    public void GetModelPath_KnownLocationWithoutFile_ReturnsNull()
    {
        BuildService().GetModelPath("hvoiny").Should().BeNull();
    }

    [Fact]
    public void GetModelPath_UnknownLocation_ReturnsNull()
    {
        CreateModel("pripyat.glb");

        BuildService().GetModelPath("pripyat").Should().BeNull();
    }

    [Theory]
    [InlineData("../appsettings")]
    [InlineData("..\\appsettings")]
    [InlineData("../../secrets")]
    [InlineData("hvoiny/../../appsettings")]
    [InlineData("C:\\Windows\\win")]
    [InlineData("")]
    public void GetModelPath_PathTraversalAttempt_ReturnsNull(string location)
    {
        BuildService().GetModelPath(location).Should().BeNull();
    }

    [Fact]
    public void GetModelPath_IsCaseInsensitive()
    {
        var expected = CreateModel("hvoiny.glb");

        BuildService().GetModelPath("HVOINY").Should().Be(expected);
    }
}
