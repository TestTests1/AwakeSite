using Awake.API.Filters;
using Awake.Application.Common.Interfaces;
using Awake.Application.Features.Maps.Commands.DeleteMapLayout;
using Awake.Application.Features.Maps.Commands.SaveMapLayout;
using Awake.Application.Features.Maps.Queries.GetMapLayout;
using Awake.Application.Features.Maps.Queries.GetMapLayouts;
using Awake.Application.Features.Maps.Queries.GetMapModel;
using Awake.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Awake.API.Controllers;

[ApiController]
[Route("api/maps")]
[Authorize]
public class MapsController(ISender sender) : ControllerBase
{
    [HttpGet("{location}/model")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetModel(string location, CancellationToken ct)
    {
        var result = await sender.Send(new GetMapModelQuery(location), ct);
        if (!result.IsSuccess)
            return NotFound();

        return result.Value switch
        {
            // Модель лежит во внешнем хранилище: отправляем клиента туда сами.
            // Проверка ранга при этом остаётся здесь — адрес узнаёт только тот,
            // кого сюда пустили.
            MapModelSource.RemoteUrl remote => Redirect(remote.Url),
            MapModelSource.LocalFile local => LocalModel(local.Path),
            _ => NotFound(),
        };
    }

    /// <summary>
    /// Отдаёт модель с диска.
    ///
    /// Модель весит сотни мегабайт и меняется только при пере-экспорте, поэтому
    /// к ней приделан признак версии: браузер на повторном заходе получает 304 и
    /// не качает всё заново. Признак строится из размера и времени правки файла —
    /// считать хеш от такого объёма на каждый запрос было бы дороже самой отдачи.
    /// Кеш приватный: эндпоинт закрыт рангом, и общим прокси складывать ответ
    /// у себя нельзя.
    /// </summary>
    private IActionResult LocalModel(string path)
    {
        var file = new FileInfo(path);
        var version = $"\"{file.Length:x}-{file.LastWriteTimeUtc.Ticks:x}\"";

        Response.Headers.CacheControl = "private, max-age=86400";

        // enableRangeProcessing: докачка после обрыва не должна начинаться с нуля
        return PhysicalFile(
            path,
            "model/gltf-binary",
            file.LastWriteTimeUtc,
            new EntityTagHeaderValue(version),
            enableRangeProcessing: true);
    }

    /// <summary>Список общеклановых расстановок заграждений на локации.</summary>
    [HttpGet("{location}/layouts")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetLayouts(string location, CancellationToken ct)
    {
        var result = await sender.Send(new GetMapLayoutsQuery(location), ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    [HttpGet("layouts/{id:guid}")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> GetLayout(Guid id, CancellationToken ct)
    {
        var result = await sender.Send(new GetMapLayoutQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { error = result.Error });
    }

    public record SaveLayoutRequest(string Name, string Props);

    [HttpPut("{location}/layouts")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> SaveLayout(
        string location, [FromBody] SaveLayoutRequest body, CancellationToken ct)
    {
        var result = await sender.Send(new SaveMapLayoutCommand(location, body.Name, body.Props), ct);
        return result.IsSuccess ? Ok(result.Value) : BadRequest(new { error = result.Error });
    }

    [HttpDelete("layouts/{id:guid}")]
    [RankAuthorize(UserRank.Member)]
    public async Task<IActionResult> DeleteLayout(Guid id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteMapLayoutCommand(id), ct);
        return result.IsSuccess ? NoContent() : BadRequest(new { error = result.Error });
    }
}
